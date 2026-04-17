---
title: MySQL Isolation Levels and Locking Mechanisms
timestamp: 2025-08-25 12:55:00+00:00
tags:
  - MySQL
toc: true
---

**From "Database System Concepts"**

- **Serializable:** Typically guarantees serializable schedules. However, as we shall explain, some database systems' implementations of this isolation level allow non-serializable execution in certain cases.
- **Repeatable Read:** Only allows reading committed data, and during the period when a transaction reads a data item twice, other transactions must not update that data. However, the transaction is not required to be serializable with respect to other transactions. For example, when a transaction searches for data satisfying certain conditions, it may find some data inserted by a committed transaction but may not find other data inserted by that same transaction.
- **Read Committed:** Only allows reading committed data, but does not require repeatable reads. For instance, between two reads of a transaction...
- **Read Uncommitted:** Allows reading uncommitted data. This is the lowest level of consistency that SQL permits.

To implement these isolation levels, MySQL has introduced many mechanisms. Next, the author will explain row locks, table locks, gap locks, next-key locks, and other seemingly strange concepts in the context of each isolation level's mechanisms.

### Read Uncommitted

Not much to say — this is essentially doing nothing, the most basic state of a database. Of course, to prevent dirty writes, a transaction must acquire a lock on a row before modifying it, otherwise things would be chaotic.

### Read Committed

Transaction A can only see modifications that Transaction B has already committed. But what if B modifies a row but doesn't commit? Then A can only see the version before B's modification. If B commits, A can see B's modified version. From an implementation perspective, B must be able to successfully modify, and A must be able to successfully read. The only option is to maintain both a committed version and an uncommitted version of the data. When other transactions read the data, they receive the committed version; when the writing transaction commits, the uncommitted version becomes the committed version. Of course, the writing process also needs to acquire a row lock, but that's all there is to it.

### Repeatable Read / Snapshot Isolation

This is MySQL's default isolation level. It solves non-repeatable reads and most phantom read problems.

**What is a non-repeatable read?**

Transaction A reads a row of data. Transaction B modifies that row and commits. Since no other transaction holds the write lock on that data, B can successfully modify it. When Transaction A reads the data a second time, the result differs from the previous read — this is a non-repeatable read.

One implementation approach is locking: after Transaction A reads the data, Transaction B cannot modify it. This is domineering, and while it works, it performs poorly.

You've probably thought of another approach — version snapshots. Assign an ID to each transaction and tag each data version with the transaction ID. No matter how many versions are committed afterwards, Transaction A just keeps reading its own version. This is exactly MySQL's implementation approach.

**What is a phantom read?**

Consider a simple SQL statement that finds all students older than 16:

```sql
select name
from student
where age > 18;
```

Suppose only students Zhang San and Li Si satisfy this condition. But at the same time as the query, another transaction attempts to insert a record:

```sql
insert into student values('Wang Wu',19);
```

The query results would differ depending on when this insert statement is executed.

With the experience of solving non-repeatable reads, we can directly attach transaction IDs to each data version. The query SQL's results can then be filtered by transaction ID. Transaction A executes the query, then Transaction B inserts, and Transaction A queries again — the result will certainly be the same.

However, consider this scenario:

```sql
-- Transaction A
select * from student where age > 18 and age < 20;
update student set ... where age > 18 and age < 20;

-- Transaction B
delete from student where age > 18 and age < 20;
```

To solve this problem, we either prevent Transaction B from inserting this data, or prevent A from updating. Clearly, preventing B from inserting is more reasonable, because it disrupts Transaction A's business logic. At this point, we need locking. In this scenario, Transaction A and Transaction B are not conflicting on a particular tuple — they are not accessing the same tuple, or even any tuple at all. So row locks are useless here. We need to find the common resource they are conflicting over and lock that resource.

In this scenario, it's easy to see that the resource is the index. Indeed, both Transaction A's query and Transaction B's insert need to access the index first. So we can set up a checkpoint at the index level — let A through first, and when B tries to insert, it will be blocked.

Suppose the index looks like this:

```plaintext
[16] [19] [25] [40]
```

To prevent Transaction B from inserting a node with value (18,20), we lock the node to the right of 16 and to the left of 25 in the index — that is, we prohibit inserting nodes greater than 16 and less than 25.

A question: It seems like the locking range has expanded. We originally only needed to lock (18,20), but the actual locking range becomes (16,25). This is actually a simplified approach — we only need to prevent updates to a certain leaf node in the B+Tree to achieve range-based locking. This is what MySQL calls a gap lock.

So what is a next-key lock? Most articles online say that a next-key lock is a gap lock plus a record lock. The author was also confused at first. From the solution's perspective, while we prevent new records from being inserted through the index, we also need to prevent updates to existing records within the range. So we add a write lock to all tuples within the range as well. Together, they form the oddly-named next-key lock. In essence, record locks and gap locks synchronize different resources — one is for row records, the other is for indexes based on row record fields. They lock different things.

For performance reasons, MySQL uses the multi-version approach for snapshot reads — that is, no locking. Only current reads and write operations acquire locks. Therefore, the repeatable read level does not completely solve phantom reads. See:

[Does MySQL's Repeatable Read Isolation Level Completely Solve Phantom Reads?](https://xiaolincoding.com/mysql/transaction/phantom.html#%E4%BB%80%E4%B9%88%E6%98%AF%E5%B9%BB%E8%AF%BB)

### Serializable

This is the ultimate goal of database systems. The other isolation levels are varying degrees of compromise for concurrent performance. It is primarily implemented through 2PL. In fact, if you replace all `SELECT` statements under the repeatable read level with `SELECT FOR UPDATE`, the transaction becomes serializable.

### Final Thoughts

As MySQL's default isolation level, repeatable read is already the best practice. For write skew and phantom read issues, developers should actually evaluate the execution logic of specific transactions, assess whether there's a risk of non-serializability, and flexibly use snapshot reads and current reads as appropriate to achieve a balance between performance and correctness.
