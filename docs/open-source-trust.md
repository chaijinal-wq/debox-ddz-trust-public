# 开源可信度

这个项目的可信度不能只依赖“代码公开”。最低目标是让玩家能验证三件事：

1. 这局牌是按公开随机输入洗出来的。
2. 胜负和倍数能从牌局记录复算。
3. 释放金额能从锁定金额、胜负、倍数复算。

## 可验证洗牌

正式对局必须避免服务器单方随机，也不能使用前端时间戳或房主输入。第一版采用“服务器预承诺 + 玩家准备随机数”：

1. 房间进入可开局状态时，服务器先生成 serverNonce 并公开 serverCommitment。
2. 玩家点击准备时，客户端同时生成 playerReadyNonce，并把它放进准备请求和签名 payload。
3. 三名玩家都准备后，服务器公开 serverNonce。
4. 系统校验 serverNonce 是否匹配 serverCommitment。
5. 按固定顺序组合 roomId、sessionId、roundId、serverNonce、三名 playerReadyNonce，得到 Round seed。
6. 从 Round seed 派生 shuffle seed。
7. 使用 SHA-256 counter stream 和 rejection sampling 生成索引，再执行 Fisher-Yates 洗牌。
8. 从同一个 Round seed 独立派生首叫分座位。

这样用户没有单独的 reveal 操作，也就没有“玩家不 reveal”的阶段。任何人拿到 transcript 都能重新洗出同一副牌。

当前前端原型只用于演示确定性洗牌和复算，不作为正式随机源。

生产规则：

```text
serverCommitment = sha256({ domain: "debox-ddz-server-nonce-commitment-v2", roomId, roundNumber, serverNonce })
roundSeed = sha256({ domain: "debox-ddz-round-seed-v1", roomId, sessionId, roundId, serverNonce, playerReadyNonces })
shuffleSeed = sha256("debox-ddz-shuffle-v1", roundSeed)
firstBidderSeat = sha256("debox-ddz-first-bidder-v1", roundSeed) % 3
```

服务端、公开 replay 和测试都调用 `game-core` 的 `deriveDdzRoundDeal()` 派生 seed、首叫分座位和发牌结果。洗牌和首叫分座位使用不同 domain string 派生，避免同一个 hash 被混用。

如果服务器未能按时公开 serverNonce，本局视为未开始，不产生输赢，进入系统异常处理。

## 可验证结算

结算 transcript 至少包含：

- roomId
- asset
- players
- locked caps
- landlord
- baseStake
- multiplier
- winner side
- payout result
- server commitment
- server nonce
- player ready nonces

测试用例应覆盖常见 cap 不足场景。

## 合约原则

第一版推荐“全员签名结算”：

- 合约只负责托管 ERC-20。
- 游戏结束后生成 transcript hash 和 payouts。
- 三名玩家签名确认同一份结算。
- 合约验签后释放资金。

这个方案缺点是输家可能拒签，导致等待超时退款。后续可以升级成 optimistic settlement：

- 服务端提交结算。
- 进入挑战期。
- 玩家可用 transcript 挑战错误结算。
- 无挑战后自动释放。

## 仓库透明度清单

- 规则核心必须有测试。
- 结算核心必须有测试。
- 洗牌算法必须有测试。
- 合约部署地址和源码必须可验证。
- 每个 release 标记 git tag。
- 生产配置不能隐藏影响胜负或结算的参数。
