---
title: An OOM Troubleshooting Experience
timestamp: 2026-01-25 00:00:00+00:00
tags:
  - Java
toc: true
---

## Background

Here's what happened: the operations team reported that the pre-production environment system suddenly couldn't be logged into. Checking the monitoring platform, it turned out that RSS memory had quietly maxed out, hit the kill threshold, and was terminated by k8s, causing the service to restart.

## First Clues

Since this was not an OOM thrown by the JVM, no heap dump file was preserved from before the incident. So we could only connect to the running container and manually generate one, hoping to find some clues.

Opening it in MAT:

> One instance of **com.lmax.disruptor.RingBuffer** loaded by **com.jd.framework.magicbox.isolate.classloader.PluginClassLoader @ 0xe252dea0** occupies **59,774,272 (30.14%)** bytes. The memory is accumulated in one instance of **java.lang.Object[]**, loaded by **<system class loader>**, which occupies **59,774,128 (30.14%)** bytes.
>
> Thread **org.apache.logging.log4j.core.util.Log4jThread @ 0xe6a7e2d0 Log4j2-TF-1-AsyncLogger[AsyncDefault]-1** has a local variable or reference to **com.lmax.disruptor.BatchEventProcessor @ 0xe6a7e440** which is on the shortest path to **java.lang.Object[262208] @ 0xe2b00000**. The thread **org.apache.logging.log4j.core.util.Log4jThread @ 0xe6a7e2d0 Log4j2-TF-1-AsyncLogger[AsyncDefault]-1** keeps local variables with total size **106,664 (0.05%)** bytes.
>
> Significant stack frames and local variables
> - com.lmax.disruptor.BatchEventProcessor.run()V (BatchEventProcessor.java:141)
>   - com.lmax.disruptor.BatchEventProcessor @ 0xe6a7e440 retains 64 (0.00%) bytes
>
> **Keywords**
> - com.lmax.disruptor.RingBuffer
> - com.jd.framework.magicbox.isolate.classloader.PluginClassLoader
> - java.lang.Object[]
> - com.lmax.disruptor.BatchEventProcessor.run()V
> - BatchEventProcessor.java:141

It seems like the message queue `disruptor`'s buffer was too large, causing excessive memory usage.

The images seemed to confirm this as well.

After checking the code logic, no code was found that could cause message accumulation.

The machine configuration was 2c2g — perhaps the configuration was indeed too low and memory was tight?

## A Turn of Events

So we could only increase the machine memory to 2c8g and continue monitoring.

At the same time, we added startup parameters:

```shell
export JAVA_OPTS="\
  -Xms4g \
  -Xmx6g \
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=150 \
  -XX:InitiatingHeapOccupancyPercent=40 \
  -XX:G1ReservePercent=20 \
  -XX:G1HeapRegionSize=16m \
  -XX:+ParallelRefProcEnabled \
  -XX:+UseStringDeduplication \
  -XX:+ExplicitGCInvokesConcurrent \
  -XX:+AlwaysPreTouch \
  -XX:+UseContainerSupport \
  -XX:MaxRAMPercentage=75.0 \
  -XX:InitialRAMPercentage=50.0 \
  -XX:MaxMetaspaceSize=512m \
  -XX:MetaspaceSize=512m \
  -XX:+HeapDumpOnOutOfMemoryError \
  -XX:HeapDumpPath=/export/Logs/heapdump.hprof \
  -Xlog:gc*:file=/export/Logs/gc.log:time,uptime,level,tags:filecount=5,filesize=10M \
  -DAsyncLogger.RingBufferSize=8192 \
  -DAsyncAppender.RingBufferSize=8192 \
  -DAsyncLogger.WaitStrategy=BLOCKING \
  -Dfile.encoding=UTF-8 \
"
```

After continuing to run the service for a period of time, we found that metaspace was nearly maxed out. Hot-reload-related classes accounted for half of the entire metaspace. At the same time, the heap dump file also revealed that a large number of hot-deploy-related class loaders were not being garbage collected. We suspected that the hot-deploy framework was causing metaspace leaks.

After communicating with the relevant developers, they confirmed this was a known issue with the root cause not yet identified.

Fortunately, the hot-deploy feature was only enabled in the pre-production and testing environments — it was never enabled in production.

## Unsettled Issues

> When an avalanche occurs, no single snowflake is innocent.

Although we identified that the hot-deploy framework causes metaspace memory leaks, we cannot rule out that the business code itself doesn't have memory leaks. We still need to remain cautious and continue monitoring.

The next step is to set up a simulation environment to support long-duration stress testing, to expose potential memory leak issues as early as possible.
