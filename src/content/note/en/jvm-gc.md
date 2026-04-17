---
title: GC Mechanisms in the JVM
timestamp: 2025-09-14 05:22:39+00:00
tags:
  - Java
toc: true
---

## Goals of GC

- Correctness: GC must not reclaim objects that are still in use
- Throughput: The proportion of CPU time slices occupied by user threads — the higher, the better
- Low latency: When GC is running, it may need to pause all user threads — the shorter the pause, the better
- Low memory overhead: The extra memory overhead incurred by implementing GC should be as low as possible

Overall, while ensuring correctness, GC should minimize its consumption of CPU and memory resources, as well as its blocking of user threads.

*Among GC algorithm implementations, there are two major schools: reference counting and reachability analysis. Reference counting suffers from an inherent flaw — it cannot resolve circular references. Most programming languages with GC adopt the reachability analysis approach, and Java is no exception.*

## Reachability Analysis

Starting from a set of known, non-reclaimable objects (GC Roots), traverse all reachable objects — essentially searching the object reference graph with GC Roots as the starting point. Objects not in the graph can be reclaimed.

### **Fast Root Enumeration**

The reference locations of GC Roots such as constants or class static fields can be determined during class loading. For example:

```java
class A{
    // During class loading, the location of B's reference is already determined
    // At runtime, what object B points to is uncertain — i.e., the content (memory address) inside B is uncertain
    // But where the reference B is stored is certain
    static Object B = new Object()
}
/*
For instance, after class loading completes, 0x01 stores the address of the B object.
We don't know what's inside 0x01, but we know 0x01 definitely holds a reference to an object,
so we can use 0x01 as a scanning starting point
*/
```

Similarly, references in a thread's execution context can also be determined before the code executes to a specific line:

```java
public void f(){
    Object a = new Object();
    Object b = new Object();
    // When code execution reaches here, the addresses of references a and b
    // will be placed into slots in the local variable table of the stack frame in a fixed order
    // We can also record the memory addresses of these slots as scanning starting points
}
```

**OopMap**: A data structure used by Java to store the memory addresses mentioned above. During GC, as long as the current OopMap is obtained, scanning starts from within the OopMap.

During code execution, the reference locations in the execution context are not static. If we recorded reference locations after executing a certain line, and then the code continues to execute — the original stack frame may be popped and a new stack frame for another method may be pushed — scanning based on the previously saved locations would be like "marking the boat to find the sword." Therefore, we need to pause user threads.

The process is roughly as follows: first, select certain execution positions, then compute and save the **OopMap** for those positions — this can be done in advance. Then, when a user thread reaches that point, it stops and scans the previously saved OopMap. After scanning is complete, the user thread is released.

So for GC, Java does additional work during compilation or class loading — analyzing each piece of code that user threads might execute, selecting certain positions called **safepoints**, generating OopMaps for these safepoints, and setting a flag. When a thread executes safepoint code, it reads the flag to determine whether GC is needed. If so, it suspends itself and waits for other threads to suspend. After all user threads are suspended, the GC thread reads all references in the OopMap and adds them to the scanning set, then releases the user threads and enters the **concurrent marking** phase.

### Concurrency in Reachability Analysis (Concurrent Marking)

To control pause times, the garbage collector needs to execute concurrently with user threads during the marking phase. When an already-scanned object adds a new reference, and the referenced object is not referenced by any other unscanned object (or had references that were deleted), this object would be mistakenly identified as garbage and reclaimed — this is extremely dangerous.

The object disappearance problem occurs when both of the following conditions are met simultaneously:

- The mutator inserts one or more new references from a black object to a white object;
- The mutator deletes all direct or indirect references from gray objects to that white object.

To solve this problem, there are two strategies:

- Incremental Update
- Snapshot At The Beginning (SATB)

**Incremental Update**

Focuses on the first condition. When a black object (already scanned) needs to add a new reference, it is recorded and rescanned after concurrent scanning finishes. This can be understood as: when a black object adds a new reference, it is turned back into a gray object (visited but references not fully scanned).

**Snapshot At The Beginning (SATB)**

Focuses on the second condition. When a gray or white object needs to delete a reference, it is recorded. After concurrent scanning finishes, scanning starts again from these deleted references — essentially, not treating them as garbage.

**What if a black object adds a new reference during concurrent marking, and this reference doesn't exist in any gray/white object?**

In the incremental update strategy, this situation is recorded and rescanned after marking finishes.

In the SATB strategy, this situation is not recorded, but all newly created objects during concurrent marking are marked as alive.

## Reclamation Algorithms

- **Mark-Sweep**

  Scan once, mark garbage objects as free memory.

  Drawback: Memory fragmentation.

- **Mark-Compact**

  Based on mark-sweep, move surviving objects to a fixed end of memory, freeing up contiguous blocks of memory.

  Drawback: Time-consuming.

- **Copying**

  Divide memory into two halves, using only one half at a time. During each GC, copy surviving objects to the other half, then the original half becomes entirely free.

  Drawback: High memory usage; if there are many surviving objects, copying overhead is also large.

## Generational Collection

![Traditional GC Memory Layout](https://awps-assets.meituan.net/mit-x/blog-images-bundle-2016/8a9db36e.png)

### **Core Idea**

Most objects are short-lived, while some need to persist. If every GC performs a full heap scan, it's difficult to balance throughput and performance. Therefore, objects are partitioned — some need more frequent GC, while others don't.

Young Generation: Uses the copying algorithm. When the Eden space is full, a minor GC is triggered. Surviving objects are moved to the survivor space, and older objects in the survivor space are promoted to the old generation.

Old Generation: Uses mark-sweep or mark-compact. When old generation space is insufficient, a major GC or full GC is triggered.

### **Cross-Generational Reference Problem**

When performing GC scanning on only one region, inter-region reference relationships cannot be analyzed. For example, if an object A in the young generation is only referenced by object B in the old generation, and we only scan the young generation, A would be treated as garbage — but it shouldn't be reclaimed.

So what should we do? Scan the old generation again? This defeats the purpose of generational collection.

A remembered set is used to maintain cross-generational reference relationships. If an object B in the old generation wants to reference an object in the young generation, B is added to the remembered set. When scanning the young generation, objects in the remembered set are scanned together. The granularity of the remembered set shouldn't be too small (high memory cost) or too large (high scanning cost). The old generation is divided into blocks — if any object in a block references the young generation, that block is marked in the remembered set, and all objects in that block are scanned.

## Concurrent Compaction

The G1 collector only avoids affecting user threads during the marking phase, but still needs to pause user threads during the compaction phase. This is because during compaction, the addresses of surviving objects change, so references held by other objects may become invalid.

There's nothing that adding an indirection layer can't solve — and if there is, add another layer.

We just need to ensure that the **object reference (pointer) → object physical address** access operation always remains valid. ZGC solves this with **colored pointers + read barriers**.

Unlike traditional collectors that store GC information in object headers or extra JVM-level data structures, ZGC boldly places GC information in object pointers (addresses/references), sacrificing some address space but gaining many additional benefits.

Structure of colored pointers:

![Colored Pointer Structure](/images/image-20250906145114266.png)

ZGC adds a read barrier to all object access operations. Before access, it checks the remapped bit:

If it's 0, the object points to the old address. The read barrier triggers a slow path, looks up the forwarding table, brings in the new address, and sets the remapped bit to 1.

If it's 1, access directly.

This process of replacing old addresses with new ones when accessed is called **Self-Healing**.

Overall, ZGC's cleanup process can be divided into three steps:

- Concurrent Marking: Nothing innovative here — similar to G1 and CMS. The difference is that ZGC only changes the m1/m0 bits of pointers.
- Concurrent Relocation Preparation: Full heap scan, select a batch of pages that need compaction, pre-allocate positions in new pages, and create forwarding tables.
- Concurrent Relocation: Move objects from old addresses to new addresses, update forwarding tables.
- Concurrent Remapping: Repair old pointers. Due to the existence of read barriers, this is not a process that needs to be done deliberately — during the next GC scan, all pointers are automatically repaired.

## Development Milestones

### Serial Series

Generational, single-threaded, fully STW (while GC threads are running) collectors. They may seem outdated, but compared to other collectors, they have smaller extra memory overhead. Therefore, they still have a place in desktop application scenarios and popular microservice and cloud-native scenarios.

### Parallel Series

Compared to the Serial series, multi-threading is introduced — multiple GC threads work together during the GC process. However, this process still requires pausing user threads. Parallel also provides tuning parameters for actively setting maximum pause time and throughput.

### CMS

Compared to its predecessors, **concurrent marking** is introduced. During the marking phase, user threads don't need to be paused. After concurrent marking completes, there is a STW to correct results (inconsistencies from the concurrent marking phase), followed by sweeping. Since CMS uses the **mark-sweep** algorithm, which doesn't affect user processes, this phase is also concurrent.

Due to its mark-sweep strategy, it generates a lot of memory fragmentation. When there's too much fragmentation and new objects can't fit, a Full GC is triggered — **mark-compact** across the entire heap — causing long pauses. This is the main reason CMS has been widely criticized.

### G1

A small step for Oracle, a giant leap for GC development. It pioneered the Region-based memory layout, full heap collection, introduced a pause time prediction model, and supports user-customizable pause times. Each GC uses a "greedy algorithm" to select the most valuable Regions to reclaim. Through continuous iteration, G1 now outperforms CMS in various scenarios and has become the default collector in newer JDK versions.

### ZGC

The cutting-edge achievement in GC, achieving **concurrent compaction** with ultra-low latency — a **orders-of-magnitude** difference compared to its predecessors. At the same time, throughput is not compromised. Especially in JDK 21, ZGC also introduced generational collection — truly the direction of the future.

![GC Throughput Comparison](/images/image-20250914152829967.png)

![GC Latency Comparison](/images/image-20250914152855867.png)

The above images are from ["The Z Garbage Collector: Low Latency GC for OpenJDK"](https://cr.openjdk.org/~pliden/slides/ZGC-Jfokus-2018.pdf), comparing the throughput and latency of three collectors.
