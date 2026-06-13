// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockBoxToken {
    string public constant name = "Mock BOX";
    string public constant symbol = "BOX";
    uint8 public constant decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint16 public transferFeeBps;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    function mint(address to, uint256 amount) external {
        require(to != address(0), "ZERO_TO");
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function setTransferFeeBps(uint16 nextTransferFeeBps) external {
        require(nextTransferFeeBps <= 10_000, "FEE");
        transferFeeBps = nextTransferFeeBps;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "ALLOWANCE");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(to != address(0), "ZERO_TO");
        require(balanceOf[from] >= amount, "BALANCE");
        uint256 fee = (amount * transferFeeBps) / 10_000;
        uint256 received = amount - fee;
        balanceOf[from] -= amount;
        balanceOf[to] += received;
        emit Transfer(from, to, received);
        if (fee > 0) {
            emit Transfer(from, address(0), fee);
        }
    }
}
