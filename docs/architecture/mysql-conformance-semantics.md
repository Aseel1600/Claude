---
title: "MySQL 一致性语义与故障模式矩阵"
status: proposed-test-specification
lastUpdated: 2026-07-30
---

# MySQL 一致性语义与故障模式矩阵

- **跟踪 Issue：** [#8075](https://github.com/diegosouzapw/OmniRoute/issues/8075)
- **前置设计：** [可插拔持久化边界](persistence-backend-boundary.md)
- **现状依据：** [SQLite 耦合盘点](sqlite-coupling-inventory.md)
- **范围：** MySQL 8.0+ 与 InnoDB 的可观察语义、失败分类及未来一致性测试规格
- **运行时影响：** 无；本文不添加数据库驱动、配置、schema、migration 或生产支持声明

## 目的

持久化边界 ADR 要求跨后端测试验证行为，而不只是验证 Repository 方法签名。本文把
MySQL/InnoDB 可能与当前 SQLite 行为产生差异的部分转成显式契约问题和建议测试规格，供未来
MySQL adapter 及其一致性测试使用。

本文不把某个驱动的返回字段或某种 SQL 写法提升为领域契约。Repository 应定义调用者能够观察到的
结果；SQLite 和 MySQL 实现可以使用不同机制，只要满足同一结果、原子性与错误分类要求。

## 设计原则

1. **先固定行为，再选择 SQL。** SQL 方言相似不代表替换、更新、排序或失败结果等价。
2. **显式配置影响语义。** 字符集、collation、SQL mode、连接 flags、事务隔离级别和时区必须由
   backend 初始化确定或验证，不能继承服务器偶然默认值。
3. **领域结果不暴露驱动计数。** Repository 应返回领域定义的结果，不能让 `affectedRows`、
   `changes` 或 `lastInsertRowid` 成为跨后端 API。
4. **只重试完整原子操作。** 死锁或序列化冲突后的重试必须重新执行整个 Repository 操作，并遵守
   幂等约束。
5. **无显式顺序就没有顺序契约。** 任何列表或分页 API 都必须给出完整 `ORDER BY` 和唯一
   tie-breaker。
6. **DDL 与 DML 分开协调。** 迁移所有权、schema 历史和失败恢复属于 backend 运维契约，不属于
   普通 Repository 事务。

## 语义矩阵

### 1. Collation、大小写与唯一约束

| 主题         | MySQL/InnoDB 行为                                                                                                         | 与 SQLite 的风险                                                                 | 跨后端契约要求                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 文本相等     | MySQL 文本比较由列或表达式的 collation 决定；带 `_ci` 的 collation 通常忽略大小写，带 `_ai` 的 collation 还会忽略重音差异 | SQLite 默认文本比较与显式 `COLLATE NOCASE` 并不等同于 MySQL 的 Unicode collation | 每个可移植文本键必须声明是字节精确、大小写不敏感还是面向用户的语言比较             |
| 唯一键       | 唯一索引按索引列的 collation 判定冲突                                                                                     | 同一组字符串可能在一个后端可共存、另一个后端冲突                                 | schema 必须为身份键选择显式 collation；错误统一分类为唯一约束冲突                  |
| 大小写规范化 | 应用层规范化与数据库 collation 可以叠加                                                                                   | 只在一个 adapter 中做 lowercase 会造成数据和查找结果漂移                         | 若领域采用规范化，必须在 Repository 契约中定义，并在所有后端写入和查询路径一致执行 |

MySQL 参考：
[Character Sets, Collations, Unicode](https://dev.mysql.com/doc/refman/8.0/en/charset.html)、
[Unicode Character Sets](https://dev.mysql.com/doc/refman/8.0/en/charset-unicode-sets.html)。

### 2. `NULL`、唯一键与排序

| 主题                | MySQL/InnoDB 行为                                              | 与 SQLite 的风险                                                     | 跨后端契约要求                                                                   |
| ------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 唯一索引中的 `NULL` | 唯一索引允许多个包含 `NULL` 的键值，因为这些值不被视为彼此相等 | SQLite 的唯一列也允许多个 `NULL`，但复合键和领域“缺失值”仍可能被误解 | 测试单列和复合唯一键；若业务要求“最多一个缺失值”，必须使用额外约束或原子操作表达 |
| 排序位置            | MySQL 的升序通常把 `NULL` 排在非 `NULL` 之前，降序相反         | 不应把任一后端的隐式 `NULL` 位置当成 API 语义                        | 列表契约必须显式表达 `NULL` 的目标位置；adapter 可用布尔排序键加实际列实现       |
| 缺失记录            | SQL 未命中和字段值为 `NULL` 是两种结果                         | 宽松返回类型可能把二者都映射为 `null`                                | Repository 结果必须区分“记录不存在”和“记录存在但可空字段为空”                    |

SQLite 的 `NULL` 行为依据见
[NULL Handling in SQLite Versus Other Database Engines](https://sqlite.org/nulls.html)。MySQL 唯一索引
规则见
[CREATE TABLE Statement](https://dev.mysql.com/doc/refman/8.0/en/create-table.html)。

### 3. 确定性排序与分页

| 主题           | MySQL/InnoDB 行为                                  | 故障模式                                        | 跨后端契约要求                                                           |
| -------------- | -------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| 无 `ORDER BY`  | 查询结果顺序未定义，可能随执行计划、索引或版本变化 | 在本地看似稳定，但部署到 MySQL 后翻页重复或漏项 | 所有对外列表必须有显式排序                                               |
| 排序值相同     | 只按非唯一列排序时，同值记录的相对顺序未定义       | offset 或 cursor 页边界不稳定                   | 排序末尾必须追加稳定且唯一的 ID tie-breaker                              |
| Cursor 分页    | 比较谓词必须与排序方向和所有 tie-breaker 一致      | 混合升降序或遗漏 ID 会跳过/重复记录             | 一致性测试必须跨多页插入相同主排序值，并验证精确并集与无重复             |
| Collation 排序 | 文本顺序随 collation 改变                          | SQLite 与 MySQL 返回顺序不同                    | 若 API 暴露文本顺序，契约必须固定 collation 语义；否则使用后端无关排序键 |

项目中已经存在显式唯一 tie-breaker 的 SQLite 查询，例如
`src/lib/db/batches.ts` 使用时间列和 ID 共同分页。该模式是契约候选，而不是可直接复制到每个领域的
通用实现。

MySQL 参考：
[ORDER BY Optimization](https://dev.mysql.com/doc/refman/8.0/en/order-by-optimization.html)。

### 4. 更新、no-op 与受影响行数

MySQL 的 DML 返回计数受语句类型和客户端连接行为影响。普通 `UPDATE` 默认报告实际改变的行数；启用
MySQL C API 的“found rows”连接选项后可报告匹配行数。Repository 不能把这个连接级差异直接暴露为领域结果。

| 操作                        | 可观察问题                        | 契约要求                                                   |
| --------------------------- | --------------------------------- | ---------------------------------------------------------- |
| 更新现有记录并改变值        | 是否成功更新目标                  | 返回领域成功或更新后的记录，不直接返回驱动计数             |
| 更新现有记录但值相同        | 是成功 no-op，还是“记录不存在”    | 契约必须选择一种；建议视为成功 no-op，并与缺失记录分开     |
| 带版本条件的 compare/update | 0 行可能表示缺失或版本冲突        | 通过读取、版本条件或专用结果区分 `not_found` 和 `conflict` |
| 删除                        | 重复删除是成功 no-op 还是缺失错误 | 每个 Repository 方法显式定义，所有后端保持一致             |
| 批量修改                    | 返回匹配数还是实际改变数          | 只暴露契约定义的计数，并用相同数据集跨后端校验             |

MySQL 参考：
[UPDATE Statement](https://dev.mysql.com/doc/refman/8.0/en/update.html)。

### 5. Upsert 与替换

SQLite 的 `INSERT OR REPLACE` 在唯一键冲突时会先删除冲突行，再继续插入；它不是普通 UPDATE。
SQLite 耦合盘点在记录的快照中发现了大量该语法，因此未来 adapter 不能机械替换成 MySQL
`INSERT ... ON DUPLICATE KEY UPDATE`。

两者可能在以下方面产生可观察差异：

- 外键和级联删除；
- delete/insert/update trigger；
- 未在新行中提供的列值；
- 自动生成 ID；
- 创建时间与更新时间；
- 驱动报告的受影响行数。

跨后端 Repository 必须先为每个 upsert 定义下列行为之一：

1. **保持身份的更新：** 冲突时保留同一逻辑记录和不可变字段，仅更新允许字段；
2. **显式替换：** 删除旧记录并创建新记录，且把级联副作用列入契约；
3. **仅插入：** 冲突统一返回约束错误，不执行更新。

不得把三种行为都实现成一个无说明的通用 upsert。

参考：
[SQLite ON CONFLICT](https://sqlite.org/lang_conflict.html)、
[MySQL INSERT ... ON DUPLICATE KEY UPDATE](https://dev.mysql.com/doc/refman/8.0/en/insert-on-duplicate.html)。

### 6. `utf8mb4` 与索引长度

MySQL 的字符索引占用按编码后的字节计算；`utf8mb4` 中一个字符最多可占四字节。InnoDB 可接受的
索引键长度还受 row format 和 page size 等条件影响。因而在 SQLite 中可建索引的长文本，迁移为
MySQL 唯一索引时可能失败或被迫使用前缀索引。

契约和 schema 要求：

- 身份键必须设置经过验证的最大字符长度；
- 不得用前缀唯一索引冒充完整字符串唯一性；
- migration dry run 必须使用最长 Unicode 样本验证索引；
- schema 检查必须拒绝会截断身份语义的定义；
- 错误应分类为 schema/migration 不兼容，而不是运行时唯一冲突。

MySQL 参考：
[The utf8mb4 Character Set](https://dev.mysql.com/doc/refman/8.0/en/charset-unicode-utf8mb4.html)、
[InnoDB Limits](https://dev.mysql.com/doc/refman/8.0/en/innodb-limits.html)。

### 7. ID 与 `LAST_INSERT_ID()`

持久化边界 ADR 已禁止把 `lastInsertRowid` 作为跨后端领域契约。MySQL 的
`LAST_INSERT_ID()` 与当前连接和自动递增列相关；upsert 还可能影响其含义。连接池中若把“执行写入”
与“读取 ID”拆成两次租用，结果可能来自错误连接。

契约要求：

- 优先由应用生成稳定 ID，并把 ID 作为插入输入；
- 若必须使用数据库生成 ID，插入和取回 ID 必须由同一驱动操作原子完成；
- 不允许 Repository 调用者另行查询连接级“最后 ID”；
- upsert 必须明确返回原记录 ID 还是新 ID；
- 重试不能无意创建第二个逻辑记录。

MySQL 参考：
[Information Functions](https://dev.mysql.com/doc/refman/8.0/en/information-functions.html)。

### 8. 事务隔离、死锁与锁等待

InnoDB 默认隔离级别是 `REPEATABLE READ`，并允许多个并发写事务。SQLite 通常只允许一个并发写
事务，且当前 adapter 还区分 deferred 和 immediate transaction。直接复制事务调用形状不能保证相同
的并发结果。

| 失败/并发现象              | 领域风险                               | 分类和处理要求                                                 |
| -------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| Deadlock victim            | 一个事务被 InnoDB 回滚                 | 标记为可重试冲突；从 Repository 原子操作起点重新执行           |
| Lock wait timeout          | 语句因等待超时失败；事务状态不能靠猜测 | adapter 必须规范化状态并显式回滚，之后才允许重试               |
| Duplicate key race         | 两个事务同时创建相同身份               | 返回统一唯一冲突，或由契约定义的幂等成功                       |
| Snapshot read              | 同一事务中可能持续看到旧快照           | Repository 不能假定读取会自动观察其他事务刚提交的数据          |
| Lost update                | read-modify-write 覆盖并发修改         | 使用版本条件、锁定读或单语句原子更新，并测试冲突结果           |
| Retry after unknown commit | 客户端断连时不知道提交是否完成         | 写操作需要稳定幂等键或可查询的操作身份，不得盲目重复非幂等写入 |

MySQL 参考：
[InnoDB Transaction Isolation Levels](https://dev.mysql.com/doc/refman/8.0/en/innodb-transaction-isolation-levels.html)、
[Deadlocks in InnoDB](https://dev.mysql.com/doc/refman/8.0/en/innodb-deadlocks.html)、
[How to Minimize and Handle Deadlocks](https://dev.mysql.com/doc/refman/8.0/en/innodb-deadlocks-handling.html)。
SQLite 对照：
[Transactions](https://sqlite.org/lang_transaction.html)。

### 9. DDL、隐式提交与迁移锁

MySQL 中多类 DDL 和管理语句会隐式提交，不能假定“把 migration SQL 放入普通事务”就能获得 SQLite
式整体回滚。即使 MySQL 支持 atomic DDL，也不等于包含多条 migration 语句和数据回填的整个步骤可
回滚。

迁移契约必须定义：

- 全局唯一 migration owner；
- 获取锁后的 schema-history 检查；
- 每个物理 migration 的前置条件和完成标记；
- DDL 与数据回填的可恢复检查点；
- 进程终止或连接断开后的锁释放与接管；
- 部分完成时是安全重试、补偿还是阻止启动；
- readiness 只有在所需逻辑里程碑完成后才成功。

进程内 mutex 不能满足多副本迁移所有权。未来 MySQL 实现必须使用数据库可见的租约、命名锁或等价
机制，并用两个独立连接和两个模拟副本测试互斥及接管。

MySQL 参考：
[Statements That Cause an Implicit Commit](https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html)、
[Atomic Data Definition Statement Support](https://dev.mysql.com/doc/refman/8.0/en/atomic-ddl.html)。

### 10. JSON、精确数值与时间

| 类型        | MySQL/InnoDB 风险                                                                    | 跨后端契约要求                                                                     |
| ----------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| JSON        | MySQL 原生 JSON 会验证并采用内部表示；文本空白、键顺序或重复键不适合作为业务相等依据 | 明确是结构化值还是不透明文本；结构化值按解析后的领域对象比较，序列化输出应规范化   |
| 整数        | JavaScript 安全整数范围可能小于数据库整数范围                                        | 对超过安全范围的值使用字符串或经过验证的专用类型，不经过浮点数往返                 |
| `DECIMAL`   | 驱动可能返回字符串，也可能配置为数值                                                 | 金额和额度使用固定 precision/scale；领域边界使用精确十进制表示，不用二进制浮点比较 |
| `TIMESTAMP` | MySQL 会受 session time zone 和列精度影响                                            | backend 初始化固定 session time zone；契约固定 UTC、精度和序列化格式               |
| `DATETIME`  | 不自动代表时区                                                                       | 只有契约明确为无时区本地时间时才使用；持久事件时间优先使用明确 UTC 规则            |

MySQL 参考：
[The JSON Data Type](https://dev.mysql.com/doc/refman/8.0/en/json.html)、
[Precision Math](https://dev.mysql.com/doc/refman/8.0/en/precision-math.html)、
[Date and Time Types](https://dev.mysql.com/doc/refman/8.0/en/date-and-time-types.html)。

### 11. 原子关联修改与外键

涉及父记录和关联记录的 Repository 操作必须在同一 transaction context 内完成。典型操作包括：

- 删除定义及其 mappings；
- 替换一组有序成员；
- 创建主体及其唯一关联；
- 更新版本字段并写入审计信息。

MySQL adapter 必须验证：

- 任意中间语句失败会回滚全部关联修改；
- 外键冲突和唯一冲突得到不同的 backend-neutral 分类；
- cascade 行为若属于 schema，必须与领域契约一致；
- 重试使用新的 transaction context，不能复用已经失败的事务；
- 调用者取消或连接关闭不会留下部分修改。

## 建议的一致性测试规格

以下是测试规格，不是当前已存在的测试函数。命名采用行为描述，未来 harness 可按项目测试约定转换为
实际名称。除特别说明外，每个场景都应使用同一 fixture 分别运行 SQLite 和 MySQL 实现。

### CRUD 与缺失记录

1. **创建后按 ID 读取保持领域值**
   - 场景：写入包含 Unicode、可空字段、JSON 和时间字段的记录。
   - 断言：读取结果与规范化后的输入相等；不比较数据库专属序列化细节。
2. **读取不存在的 ID 返回统一缺失结果**
   - 场景：查询从未创建或已删除的 ID。
   - 断言：两个后端返回同一 `not found` 领域结果，不与“可空字段为空”混淆。
3. **删除行为保持幂等约定**
   - 场景：连续删除同一 ID 两次。
   - 断言：第一次和第二次结果严格符合该 Repository 已声明的成功/no-op 或缺失契约。

### 唯一性、collation 与 `NULL`

4. **身份键大小写行为与契约一致**
   - 场景：依次创建仅大小写不同的两个键。
   - 断言：若契约为大小写敏感，两条都成功；否则第二条返回统一唯一冲突。
5. **身份键重音行为与契约一致**
   - 场景：创建只在重音上不同的 Unicode 键。
   - 断言：结果不依赖服务器默认 collation，而与 schema 声明一致。
6. **唯一可空键允许或拒绝多个缺失值的规则明确**
   - 场景：创建两个唯一键字段均为 `NULL` 的记录。
   - 断言：结果符合领域规则；若领域只允许一个缺失值，由 Repository 原子保证。
7. **唯一冲突得到 backend-neutral 分类**
   - 场景：并发创建相同身份键。
   - 断言：至多一个创建成功，其余结果分类一致，且没有泄漏 SQL 文本或驱动错误码。

### 排序与分页

8. **完整排序键产生确定性结果**
   - 场景：插入多条主排序值相同但 ID 不同的记录。
   - 断言：重复查询顺序相同，且与声明的 ID tie-breaker 一致。
9. **跨页遍历无重复无遗漏**
   - 场景：使用小 page size 遍历包含大量同排序值的 fixture。
   - 断言：所有页的 ID 并集等于完整集合，交集为空。
10. **可空排序字段的位置固定**
    - 场景：混合 `NULL` 和非 `NULL` 排序值。
    - 断言：`NULL` 位于契约指定的一端，SQLite 与 MySQL 顺序一致。

### 更新与 affected-row 语义

11. **相同值更新与缺失记录可区分**
    - 场景：先用相同值更新现有记录，再更新不存在的 ID。
    - 断言：前者是已声明的成功 no-op，后者是 `not found`；结果不随 MySQL 的“found rows”连接选项改变。
12. **实际修改返回领域成功**
    - 场景：修改一个可变字段。
    - 断言：返回值和再次读取均反映新值，不暴露 driver affected-row 计数。
13. **比较更新能识别版本冲突**
    - 场景：两个调用使用相同旧版本依次更新。
    - 断言：一个成功，另一个返回统一 conflict；最终版本只增加一次。
14. **批量计数采用契约定义**
    - 场景：批量命中若干记录，其中部分值未变化。
    - 断言：返回计数按“匹配”或“实际改变”的既定定义计算，且不受连接 flag 影响。

### Upsert、ID 与关联原子性

15. **保持身份的 upsert 不触发替换副作用**
    - 场景：创建带关联记录的主体，再以同一身份 upsert 可变字段。
    - 断言：主体 ID、不变字段和关联记录保留，只更新允许字段。
16. **数据库生成 ID 在同一操作中返回**
    - 场景：并发连接分别创建记录。
    - 断言：每个调用返回自己的 ID，且读取到对应内容；不使用后续连接级查询关联 ID。
17. **关联修改全部提交或全部回滚**
    - 场景：在父记录修改后故意让关联写入触发约束错误。
    - 断言：父记录和所有关联均保持操作前状态。
18. **外键与唯一错误分类不同**
    - 场景：分别触发缺失父记录和重复唯一键。
    - 断言：返回两种稳定分类，响应不包含后端消息。

### 并发、重试和迁移

19. **死锁重试重新执行完整原子操作**
    - 场景：用相反锁顺序制造两个事务死锁，并为操作提供稳定幂等身份。
    - 断言：victim 被分类为可重试；重试后不出现部分状态或重复业务效果。
20. **锁等待超时清理事务上下文**
    - 场景：一个连接持锁，另一个连接超时。
    - 断言：失败连接显式回滚；旧 context 被拒绝，后续工作使用新事务。
21. **未知提交结果可以安全重放或查询**
    - 场景：在提交边界模拟连接丢失。
    - 断言：幂等身份保证最多一个业务效果，调用者可确定最终结果。
22. **只有一个 migration owner**
    - 场景：两个独立 backend 实例同时尝试相同 migration。
    - 断言：只有一个实例执行，另一个等待或返回可分类状态；历史记录只写一次。
23. **部分 migration 阻止 readiness**
    - 场景：在 DDL 完成、数据回填完成前注入故障。
    - 断言：backend 不报告 ready；恢复路径从可验证检查点继续或明确阻止启动。

### 数据表示

24. **JSON 按领域结构往返**
    - 场景：写入键顺序和空白不同但结构等价的 JSON。
    - 断言：领域读取结果结构等价；不把原始文本字节相等作为契约。
25. **精确十进制无舍入漂移**
    - 场景：写入 precision/scale 边界值和常见二进制浮点非精确值。
    - 断言：读取的精确十进制表示与输入一致，越界输入在写入前或写入时得到统一分类。
26. **时间统一为 UTC 和固定精度**
    - 场景：在不同 session time zone 下写入和读取同一 instant。
    - 断言：领域序列化相同，精度符合契约且不受服务器本地时区影响。

## Adapter 开始前必须冻结的决策

在添加 MySQL 驱动或 schema 前，首个领域切片必须明确回答：

1. 哪些文本键大小写敏感、重音敏感，以及使用哪类显式 collation；
2. 所有列表的完整排序键、`NULL` 位置和 pagination tie-breaker；
3. no-op update、重复 delete 和批量计数的领域结果；
4. 每个写入是 insert、保持身份的 upsert，还是显式 replacement；
5. ID 由应用还是数据库生成，以及重试时的幂等身份；
6. 哪些冲突可重试，最大重试范围由谁控制；
7. migration ownership、失败检查点和 readiness 条件；
8. JSON、整数、十进制与时间的领域表示。

未冻结这些语义时，实现 MySQL adapter 只会把数据库默认行为意外变成 API，之后难以在不破坏兼容性的
前提下修正。

## 非目标

本文不：

- 批准或宣称 PostgreSQL/MySQL 已受支持；
- 添加 MySQL driver、连接池、环境变量或配置 UI；
- 定义具体 Repository TypeScript 接口；
- 添加或修改 schema 与 migration；
- 把 MySQL SQL 写法用于 SQLite；
- 要求 SQLite 模拟 InnoDB 的内部隔离或锁实现；
- 实现本文列出的测试；
- 取代每个领域切片自己的行为和并发验收标准。

## 后续使用方式

未来 MySQL 工作应按以下顺序使用本文：

1. 选择一个已经通过 SQLite 一致性测试的领域切片；
2. 从本文中提取该领域涉及的语义并冻结契约决策；
3. 将建议规格实现为同一 backend-neutral harness；
4. 先让 SQLite fixture 保持绿色，再接入 MySQL fixture；
5. 增加 MySQL 专属 migration、锁和故障注入测试；
6. 只有在相同契约对两个后端都通过后，才讨论用户可见配置和支持声明。
