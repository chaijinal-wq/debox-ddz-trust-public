// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Audit-before-mainnet draft for the v1 BOX-only internal-balance Session escrow.
/// @dev This is a compile-checked architecture contract, not a production-reviewed escrow.
contract DdzEscrowRoom {
    address public constant BOX_TOKEN = 0x6386Adc4BC9c21984E34fD916BB349dD861742af;
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint64 public constant MIN_FEE_RATE_NOTICE_SECONDS = 24 hours;
    uint64 public constant SESSION_REFUND_DELAY_SECONDS = 24 hours;

    enum SessionStatus {
        None,
        Locked,
        Settled,
        ManualReview,
        Refunded
    }

    struct Session {
        address[3] players;
        uint256[3] lockedBalances;
        uint256 lockedTotal;
        uint64 lockedAt;
        uint16 feeRateBps;
        SessionStatus status;
        bytes32 settlementId;
        bytes32 transcriptHash;
    }

    address public owner;
    address public relayer;
    address public feeTreasury;
    uint16 public feeRateBps;
    uint16 public feeRateMaxBps;
    uint16 public announcedFeeRateBps;
    uint64 public announcedFeeEffectiveAt;
    string public lastFeeAnnouncement;
    bool public depositsPaused;
    bool public lockingPaused;
    bool public settlementPaused;

    mapping(address => uint256) public availableBalance;
    mapping(address => uint256) public pendingWithdrawal;
    mapping(address => bytes32) public activeSessionOf;
    mapping(bytes32 => bool) public usedSettlementIds;
    mapping(bytes32 => bool) public usedSettlementNonces;
    mapping(bytes32 => bool) public usedAvailableBalanceReleaseIds;
    mapping(bytes32 => Session) private sessions;

    event Deposited(address indexed player, uint256 amount);
    event SessionLocked(bytes32 indexed sessionId, address[3] players, uint256[3] lockedBalances, uint16 feeRateBps);
    event SessionLockIncreased(
        bytes32 indexed sessionId,
        address indexed player,
        uint256 amount,
        uint256 lockedBalance,
        uint256 lockedTotal
    );
    event SessionSettled(
        bytes32 indexed sessionId,
        bytes32 indexed settlementId,
        bytes32 settlementNonce,
        bytes32 transcriptHash,
        uint256[3] finalBalances,
        uint256[3] fees,
        bool[3] withdrawToWallet,
        uint256 feeTotal,
        address indexed submittedBy
    );
    event WithdrawalQueued(address indexed player, bytes32 indexed sessionId, uint256 amount);
    event WithdrawalReleased(address indexed player, bytes32 indexed sessionId, uint256 amount);
    event AvailableBalanceReleased(address indexed player, bytes32 indexed releaseId, uint256 amount);
    event ManualReviewMarked(bytes32 indexed sessionId, address indexed actor, string reason);
    event SessionRefunded(bytes32 indexed sessionId, address indexed actor);
    event FeeRateAnnounced(uint16 feeRateBps, uint64 effectiveAt, string announcement);
    event FeeRateApplied(uint16 feeRateBps);
    event PauseStateChanged(bool depositsPaused, bool lockingPaused, bool settlementPaused);
    event RelayerChanged(address indexed relayer);
    event FeeTreasuryChanged(address indexed feeTreasury);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error Unauthorized();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidFeeRate();
    error InvalidSession();
    error InvalidSettlement();
    error SessionAlreadyExists();
    error SessionAlreadyActive();
    error InsufficientAvailableBalance();
    error Paused();
    error TokenCallFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyRelayer() {
        if (msg.sender != relayer && msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address relayer_, address feeTreasury_, uint16 feeRateMaxBps_) {
        if (relayer_ == address(0) || feeTreasury_ == address(0)) revert InvalidAddress();
        if (feeRateMaxBps_ == 0 || feeRateMaxBps_ > BPS_DENOMINATOR) revert InvalidFeeRate();

        owner = msg.sender;
        relayer = relayer_;
        feeTreasury = feeTreasury_;
        feeRateBps = 10;
        feeRateMaxBps = feeRateMaxBps_;
    }

    function deposit(uint256 amount) external {
        if (depositsPaused) revert Paused();
        if (amount == 0) revert InvalidAmount();

        uint256 beforeBalance = _tokenBalance(BOX_TOKEN, address(this));
        _safeTransferFrom(BOX_TOKEN, msg.sender, address(this), amount);
        uint256 received = _tokenBalance(BOX_TOKEN, address(this)) - beforeBalance;
        if (received == 0 || received != amount) revert TokenCallFailed();

        availableBalance[msg.sender] += received;
        emit Deposited(msg.sender, received);
    }

    function withdrawAvailable(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        if (availableBalance[msg.sender] < amount) revert InsufficientAvailableBalance();

        availableBalance[msg.sender] -= amount;
        _safeTransfer(BOX_TOKEN, msg.sender, amount);
        emit WithdrawalReleased(msg.sender, bytes32(0), amount);
    }

    function releaseAvailableBalance(address player, uint256 amount, bytes32 releaseId) external onlyRelayer {
        if (player == address(0) || amount == 0 || releaseId == bytes32(0)) revert InvalidAmount();
        if (usedAvailableBalanceReleaseIds[releaseId]) revert InvalidSettlement();
        if (availableBalance[player] < amount) revert InsufficientAvailableBalance();

        usedAvailableBalanceReleaseIds[releaseId] = true;
        availableBalance[player] -= amount;
        _safeTransfer(BOX_TOKEN, player, amount);
        emit AvailableBalanceReleased(player, releaseId, amount);
    }

    function lockForSession(
        bytes32 sessionId,
        address[3] calldata players,
        uint256[3] calldata amounts
    ) external onlyRelayer {
        if (lockingPaused) revert Paused();
        if (sessionId == bytes32(0)) revert InvalidSession();
        if (sessions[sessionId].status != SessionStatus.None) revert SessionAlreadyExists();

        uint256 lockedTotal;
        for (uint256 i = 0; i < 3; i += 1) {
            address player = players[i];
            uint256 amount = amounts[i];
            if (player == address(0) || amount == 0) revert InvalidSession();
            if (activeSessionOf[player] != bytes32(0)) revert SessionAlreadyActive();
            if (availableBalance[player] < amount) revert InsufficientAvailableBalance();
            for (uint256 j = i + 1; j < 3; j += 1) {
                if (player == players[j]) revert InvalidSession();
            }

            availableBalance[player] -= amount;
            activeSessionOf[player] = sessionId;
            lockedTotal += amount;
        }

        uint16 sessionFeeRateBps = activeFeeRateBps();
        sessions[sessionId] = Session({
            players: players,
            lockedBalances: amounts,
            lockedTotal: lockedTotal,
            lockedAt: uint64(block.timestamp),
            feeRateBps: sessionFeeRateBps,
            status: SessionStatus.Locked,
            settlementId: bytes32(0),
            transcriptHash: bytes32(0)
        });

        emit SessionLocked(sessionId, players, amounts, sessionFeeRateBps);
    }

    function increaseSessionLock(bytes32 sessionId, address player, uint256 amount) external onlyRelayer {
        if (lockingPaused) revert Paused();
        if (sessionId == bytes32(0) || player == address(0)) revert InvalidSession();
        if (amount == 0) revert InvalidAmount();
        if (activeSessionOf[player] != sessionId) revert InvalidSession();
        if (availableBalance[player] < amount) revert InsufficientAvailableBalance();

        Session storage session = sessions[sessionId];
        if (session.status != SessionStatus.Locked) revert InvalidSession();

        for (uint256 i = 0; i < 3; i += 1) {
            if (session.players[i] == player) {
                availableBalance[player] -= amount;
                session.lockedBalances[i] += amount;
                session.lockedTotal += amount;
                emit SessionLockIncreased(sessionId, player, amount, session.lockedBalances[i], session.lockedTotal);
                return;
            }
        }

        revert InvalidSession();
    }

    function settleSession(
        bytes32 sessionId,
        bytes32 settlementId,
        bytes32 settlementNonce,
        uint256[3] calldata finalBalances,
        uint256[3] calldata fees,
        bool[3] calldata withdrawToWallet,
        bytes32 transcriptHash,
        uint16 settlementFeeRateBps
    ) external onlyRelayer {
        if (settlementPaused) revert Paused();
        Session storage session = sessions[sessionId];
        if (session.status != SessionStatus.Locked && session.status != SessionStatus.ManualReview) revert InvalidSession();
        if (settlementId == bytes32(0) || settlementNonce == bytes32(0) || transcriptHash == bytes32(0)) {
            revert InvalidSettlement();
        }
        if (usedSettlementIds[settlementId] || usedSettlementNonces[settlementNonce]) revert InvalidSettlement();
        if (settlementFeeRateBps != session.feeRateBps || settlementFeeRateBps > feeRateMaxBps) revert InvalidFeeRate();
        if (
            settlementId != computeSettlementId(
                sessionId,
                settlementNonce,
                finalBalances,
                fees,
                withdrawToWallet,
                transcriptHash,
                settlementFeeRateBps
            )
        ) {
            revert InvalidSettlement();
        }

        uint256 finalTotal;
        uint256 feeTotal;
        for (uint256 i = 0; i < 3; i += 1) {
            finalTotal += finalBalances[i];
            feeTotal += fees[i];

            uint256 profit = finalBalances[i] > session.lockedBalances[i]
                ? finalBalances[i] - session.lockedBalances[i]
                : 0;
            uint256 maxFee = (profit * settlementFeeRateBps) / BPS_DENOMINATOR;
            if (fees[i] > profit || fees[i] > maxFee || fees[i] > finalBalances[i]) revert InvalidSettlement();
        }
        if (finalTotal != session.lockedTotal) revert InvalidSettlement();

        session.status = SessionStatus.Settled;
        session.settlementId = settlementId;
        session.transcriptHash = transcriptHash;
        usedSettlementIds[settlementId] = true;
        usedSettlementNonces[settlementNonce] = true;

        for (uint256 i = 0; i < 3; i += 1) {
            address player = session.players[i];
            uint256 netBalance = finalBalances[i] - fees[i];
            activeSessionOf[player] = bytes32(0);

            if (withdrawToWallet[i]) {
                if (netBalance > 0) {
                    _safeTransfer(BOX_TOKEN, player, netBalance);
                }
                emit WithdrawalReleased(player, sessionId, netBalance);
            } else {
                availableBalance[player] += netBalance;
            }
        }

        if (feeTotal > 0) {
            _safeTransfer(BOX_TOKEN, feeTreasury, feeTotal);
        }

        emit SessionSettled(
            sessionId,
            settlementId,
            settlementNonce,
            transcriptHash,
            finalBalances,
            fees,
            withdrawToWallet,
            feeTotal,
            msg.sender
        );
    }

    function releasePendingWithdrawal(address player, uint256 amount) external onlyRelayer {
        if (player == address(0) || amount == 0) revert InvalidAmount();
        _releasePendingWithdrawal(player, amount);
    }

    function claimPendingWithdrawal(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        _releasePendingWithdrawal(msg.sender, amount);
    }

    function markManualReview(bytes32 sessionId, string calldata reason) external onlyRelayer {
        Session storage session = sessions[sessionId];
        if (session.status != SessionStatus.Locked && session.status != SessionStatus.ManualReview) revert InvalidSession();

        session.status = SessionStatus.ManualReview;
        emit ManualReviewMarked(sessionId, msg.sender, reason);
    }

    function refundExpiredSession(bytes32 sessionId) external {
        Session storage session = sessions[sessionId];
        if (session.status != SessionStatus.Locked && session.status != SessionStatus.ManualReview) revert InvalidSession();
        if (block.timestamp < uint256(session.lockedAt) + SESSION_REFUND_DELAY_SECONDS) revert InvalidSession();

        session.status = SessionStatus.Refunded;
        for (uint256 i = 0; i < 3; i += 1) {
            address player = session.players[i];
            activeSessionOf[player] = bytes32(0);
            availableBalance[player] += session.lockedBalances[i];
        }

        emit SessionRefunded(sessionId, msg.sender);
    }

    function announceFeeRate(uint16 nextFeeRateBps, uint64 effectiveAt, string calldata announcement) external onlyOwner {
        if (nextFeeRateBps > feeRateMaxBps) revert InvalidFeeRate();
        if (effectiveAt < block.timestamp + MIN_FEE_RATE_NOTICE_SECONDS) revert InvalidFeeRate();

        announcedFeeRateBps = nextFeeRateBps;
        announcedFeeEffectiveAt = effectiveAt;
        lastFeeAnnouncement = announcement;
        emit FeeRateAnnounced(nextFeeRateBps, effectiveAt, announcement);
    }

    function applyAnnouncedFeeRate() external {
        if (announcedFeeEffectiveAt == 0 || block.timestamp < announcedFeeEffectiveAt) revert InvalidFeeRate();

        feeRateBps = announcedFeeRateBps;
        announcedFeeRateBps = 0;
        announcedFeeEffectiveAt = 0;
        emit FeeRateApplied(feeRateBps);
    }

    function setRelayer(address nextRelayer) external onlyOwner {
        if (nextRelayer == address(0)) revert InvalidAddress();
        relayer = nextRelayer;
        emit RelayerChanged(nextRelayer);
    }

    function setFeeTreasury(address nextFeeTreasury) external onlyOwner {
        if (nextFeeTreasury == address(0)) revert InvalidAddress();
        feeTreasury = nextFeeTreasury;
        emit FeeTreasuryChanged(nextFeeTreasury);
    }

    function setPauseState(bool nextDepositsPaused, bool nextLockingPaused, bool nextSettlementPaused) external onlyOwner {
        depositsPaused = nextDepositsPaused;
        lockingPaused = nextLockingPaused;
        settlementPaused = nextSettlementPaused;
        emit PauseStateChanged(nextDepositsPaused, nextLockingPaused, nextSettlementPaused);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, nextOwner);
        owner = nextOwner;
    }

    function activeFeeRateBps() public view returns (uint16) {
        if (announcedFeeEffectiveAt != 0 && block.timestamp >= announcedFeeEffectiveAt) {
            return announcedFeeRateBps;
        }
        return feeRateBps;
    }

    function computeSettlementId(
        bytes32 sessionId,
        bytes32 settlementNonce,
        uint256[3] calldata finalBalances,
        uint256[3] calldata fees,
        bool[3] calldata withdrawToWallet,
        bytes32 transcriptHash,
        uint16 settlementFeeRateBps
    ) public view returns (bytes32) {
        Session storage session = sessions[sessionId];
        if (session.status == SessionStatus.None) revert InvalidSession();

        address[3] memory players = session.players;
        uint256[3] memory lockedBalances = session.lockedBalances;
        return keccak256(
            abi.encode(
                "DdzEscrowRoom.settlement.v1",
                block.chainid,
                address(this),
                sessionId,
                settlementNonce,
                players,
                lockedBalances,
                session.lockedTotal,
                finalBalances,
                fees,
                withdrawToWallet,
                transcriptHash,
                settlementFeeRateBps
            )
        );
    }

    function sessionSnapshot(bytes32 sessionId)
        external
        view
        returns (
            address[3] memory players,
            uint256[3] memory lockedBalances,
            uint256 lockedTotal,
            uint16 sessionFeeRateBps,
            SessionStatus status,
            bytes32 settlementId,
            bytes32 transcriptHash
        )
    {
        Session storage session = sessions[sessionId];
        return (
            session.players,
            session.lockedBalances,
            session.lockedTotal,
            session.feeRateBps,
            session.status,
            session.settlementId,
            session.transcriptHash
        );
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        uint256 beforeBalance = _tokenBalance(token, to);
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TokenCallFailed();
        uint256 afterBalance = _tokenBalance(token, to);
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) revert TokenCallFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TokenCallFailed();
    }

    function _releasePendingWithdrawal(address player, uint256 amount) private {
        if (pendingWithdrawal[player] < amount) revert InsufficientAvailableBalance();

        pendingWithdrawal[player] -= amount;
        _safeTransfer(BOX_TOKEN, player, amount);
        emit WithdrawalReleased(player, bytes32(0), amount);
    }

    function _tokenBalance(address token, address account) private view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(0x70a08231, account));
        if (!ok || data.length < 32) revert TokenCallFailed();
        return abi.decode(data, (uint256));
    }
}
