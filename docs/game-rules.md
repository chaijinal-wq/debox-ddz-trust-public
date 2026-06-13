# 斗地主规则

本文定义第一版严肃局规则。规则必须公开、可测试、可复算。

## 基础牌局

- 使用 54 张牌。
- 三名玩家。
- 每人 17 张，底牌 3 张。
- 地主拿底牌。
- 地主对抗两名农民。

## 牌型

第一版允许以下牌型：

- 单牌
- 对子
- 三张
- 三带一
- 三带二
- 顺子
- 连对
- 飞机
- 飞机带单
- 飞机带对
- 四带二
- 四带两对
- 炸弹
- 火箭

顺子、连对、飞机限制：

- 不能包含 2。
- 不能包含大小王。
- 必须连续。

火箭：

```text
小王 + 大王
```

火箭大于所有炸弹。

## 地主确定

第一版采用 JJ 竞技风格叫分结构，并去掉抢地主、明牌、加倍、癞子等娱乐项。

```text
firstBidderSeat = sha256("debox-ddz-first-bidder-v1", roundSeed) % 3
```

流程：

1. 首叫分玩家由 Round seed 确定，不由房主、服务器或上一局胜负单独决定。
2. 座位顺序固定为逆时针 `seat0 -> seat2 -> seat1 -> seat0`；如果首叫分是 `seat2`，叫分顺序就是 `seat2 -> seat1 -> seat0`。
3. 三名玩家按座位顺序各有一次 `不叫 / 1 分 / 2 分 / 3 分` 机会。
4. 后叫玩家只能叫更高分，不能低于或等于已有最高叫分。
5. 有人叫 `3 分` 时，叫分立即结束，该玩家成为地主。
6. 如果无人叫到 `3 分`，三人都行动后，最高叫分者成为地主。
7. 如果三人都不叫，本局作废，不产生输赢，重新生成 Round seed 并重新发牌。
8. 地主拿 3 张底牌，底牌和叫分过程写入 Round transcript。
9. 第一版没有抢地主阶段，叫分只确定 `bidScore`，不触发牌局倍数。

## 洗牌随机源

正式对局使用“服务器预承诺 + 玩家准备随机数”：

1. 房间进入可开局状态时，服务器先生成 serverNonce 并公开 serverCommitment。
2. 玩家点击准备时，客户端同时生成 playerReadyNonce，并把它放进准备请求和签名 payload。
3. 三名玩家都准备后，服务器公开 serverNonce。
4. 系统校验 serverNonce 是否匹配 serverCommitment。
5. 用 roomId、sessionId、roundId、serverNonce、三名 playerReadyNonce 生成 Round seed。
6. 从 Round seed 派生 shuffle seed 后，用 SHA-256 counter stream 和 rejection sampling 生成索引，再执行 Fisher-Yates 洗牌。

```text
serverCommitment = sha256({ domain: "debox-ddz-server-nonce-commitment-v2", roomId, roundNumber, serverNonce })
roundSeed = sha256({ domain: "debox-ddz-round-seed-v1", roomId, sessionId, roundId, serverNonce, playerReadyNonces })
shuffleSeed = sha256("debox-ddz-shuffle-v1", roundSeed)
firstBidderSeat = sha256("debox-ddz-first-bidder-v1", roundSeed) % 3
```

当前原型里的前端 seed 只用于演示，不够作为正式随机源。

玩家没有单独 reveal 阶段。准备成功后，玩家随机数已经提交；如果服务器未能公开 serverNonce 或 reveal 与 commitment 不匹配，本局视为未开始，不产生输赢，进入系统异常处理。服务端、公开 replay 和测试统一调用 `game-core` 的 `deriveDdzRoundDeal()`。

## 倍数

系统固定倍数规则：

- 炸弹乘 2。
- 火箭乘 2。
- 春天乘 2。
- 反春乘 2。
- 总倍数有平台固定封顶。

第一版采用“翻倍 + 上限”，不采用 JJ 比赛里可能出现的炸弹加分制。这样开局叫分和档位不会给玩家太大心理压力，但牌局中仍保留炸弹、火箭、春天带来的刺激点。

倍数封顶是平台规则，不由房主设置。

```text
ROUND_MULTIPLIER_CAP = 16
```

房间和牌桌显眼位置必须展示“倍数封顶 16 倍”。

第一版不启用：

- 明牌倍数。
- 玩家主动加倍/超级加倍。
- 底牌牌型奖励倍数。
- 癞子玩法。
- 抢地主倍数。
- 超级炸弹或非经典牌堆。

## 输赢公式

房主只选择平台档位。档位中的首个数值作为农民基础输赢 `base`。

第一版不开放自由输入，房主只能选择平台档位：

```text
1 / 2 / 3 BOX
10 / 20 / 30 BOX
100 / 200 / 300 BOX
```

每个档位分别对应 `1 分 / 2 分 / 3 分` 的农民单位输赢。地主基础风险始终是对应农民单位的 2 倍。

本局单位输赢：

```text
unit = base * bidScore * multiplier
```

地主赢：

```text
每名农民理论输 unit
地主理论赢 2 * unit
```

农民赢：

```text
地主理论输 2 * unit
每名农民理论赢 unit
```

## 余额封顶

任何玩家最多输掉自己当前 Session 余额。

```text
actualLoss(player) <= tableBalance(player)
```

赢家只能赢到输家实际支付的金额，系统不垫付、不产生债务。

当一个输家余额不足且需要赔给多人时：

```text
按理论赔付比例分配
余数按玩家座位顺序确定性分配
```

## 出牌时间

每次出牌思考时间：

```text
叫分：60 秒
出牌：90 秒
```

超时后进入托管。离线也进入托管。

## 托管原则

托管必须公开、确定、不可 AI 化。

托管目标：

- 不暂停牌局。
- 不故意消极。
- 不做复杂策略。
- 不偷偷偏向任何玩家。

托管出牌规则：

```text
如果当前是主动出牌，必须出最小单牌。
如果当前是跟牌，不判断能不能压，统一自动不出。
```

主动出牌指桌面没有需要压过的有效牌，例如：

```text
地主第一手出牌。
上一轮其他两名玩家都不出后，当前玩家获得新一轮出牌权。
```

托管不区分地主和农民，不做队友/敌方策略判断。第一版没有玩家主动托管按钮；只有超时、离线、游戏中申请退出会触发系统托管。

托管触发必须写入 Round transcript。

## 牌局中交流

游戏中禁止：

- 文本聊天
- 表情
- 快捷短语
- 语音
- 系统外策略提示

等待区恢复聊天。

## 争议边界

产品不设置链上争议按钮，只保留反馈/客服入口。

可反馈的问题：

- 发牌 seed 无法复算。
- transcript 缺失。
- 出牌顺序记录错误。
- 托管没有按公开规则执行。
- 结算公式错误。
- 链上清算未到账。

不接受作为规则争议：

- 玩家离线后不认可托管结果。
- 托管打得不够聪明。
- 玩家后悔退出。
- 对方疑似私下沟通但没有证据。
