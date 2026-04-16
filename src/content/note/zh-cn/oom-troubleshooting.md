---
title: 一次OOM排查经历
timestamp: 2026-01-25 00:00:00+00:00
tags:
  - Java
toc: true
---

## 背景

事情是这样的，运营人员反馈预发环境系统突然登录不上，上监控平台一看，原来是RSS 内存悄悄打满，到了斩杀线，被 k8s 一波带走，服务重启。

## 初见端倪

由于这并非 JVM 抛出的 OOM，所以没有保留下案发前的堆转储文件，于是乎只能连接上运行中的容器，手动生成一份，看看能不能找出点问题

拉进 MAT 一看：

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

好像是消息队列`disruptor` 的缓冲区太大，导致内存占用过高

图片里看起来好像也是那么回事

检查代码逻辑，并没有发现可能会导致消息堆积的代码

机器配置为 2c2g ，可能是因为配置确实太低，内存紧张？

## 峰回路转

于是乎只能调大机器内存到 2c8g ，继续观察

同时，增加启动参数

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
```

继续运行服务，一段时间后，发现 metaspace 几乎打满，热更新相关的类占到了整个元空间的一半，同时，堆转储文件中也发现了大量的热部署相关的类加载器没有被回收，怀疑是热部署框架引发了metaspace 泄露

与相关研发人员沟通后，对方表示这是已知问题，原因尚未定位

值得庆幸的是，只有预发和测试环境开启了热部署功能，生产环境从未开启

## 风波未定

> 雪崩时，没有一片雪花是无辜的

虽然锁定了热部署框架会导致 metaspace 内存泄露的问题，但是也不能排除业务代码不存在内存泄露，仍需要保持谨慎，持续观察

后续需要搭建仿真环境来支持长时间的压力测试，尽早暴露出可能存在的内存泄露问题
