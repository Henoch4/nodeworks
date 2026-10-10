// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title NodeWorks — DePIN compute bounty board with on-chain settlement.
/// Posters lock a reward against a job spec; DePIN nodes claim, submit results,
/// and get paid automatically — on poster approval, arbiter ruling, or a
/// settlement timeout when the poster goes silent.
contract NodeWorks is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    struct Job {
        address poster;
        string specURI;
        uint256 reward;
        uint32 deadlineHours;
        address worker;
        string resultURI;
        uint8 state; // 0 open, 1 claimed, 2 submitted, 3 paid, 4 cancelled, 5 disputed
        uint64 claimedAt;
        uint64 submittedAt;
    }

    IERC20 public immutable rewardToken;
    address public treasury;
    uint256 public constant PLATFORM_FEE_BPS = 250; // 2.5%
    uint256 public constant SETTLEMENT_TIMEOUT = 3 days;
    uint256 public totalJobs;
    uint256 public totalRewarded;

    Job[] private _jobs;
    mapping(address => uint256) public completedJobs;
    mapping(address => uint256) public slashedJobs;

    event JobPosted(uint256 indexed jobId, address indexed poster, string specURI, uint256 reward, uint32 deadlineHours);
    event JobClaimed(uint256 indexed jobId, address indexed worker);
    event JobSubmitted(uint256 indexed jobId, address indexed worker, string resultURI);
    event JobApproved(uint256 indexed jobId, address indexed worker, uint256 payout);
    event JobDisputed(uint256 indexed jobId, address indexed poster);
    event JobResolved(uint256 indexed jobId, bool workerWins, address indexed arbiter);
    event JobCancelled(uint256 indexed jobId, address indexed poster);
    event JobTimedOut(uint256 indexed jobId, address indexed worker, uint256 payout);

    constructor(address _token) Ownable(msg.sender) {
        require(_token != address(0), "Zero token");
        rewardToken = IERC20(_token);
        treasury = msg.sender;
    }

    function postJob(string calldata specURI, uint256 reward, uint32 deadlineHours) external nonReentrant returns (uint256) {
        require(bytes(specURI).length > 0, "Empty spec");
        require(reward > 0, "Reward must be > 0");
        require(deadlineHours > 0, "Bad deadline");
        rewardToken.safeTransferFrom(msg.sender, address(this), reward);
        Job storage j = _jobs.push();
        j.poster = msg.sender;
        j.specURI = specURI;
        j.reward = reward;
        j.deadlineHours = deadlineHours;
        totalJobs += 1;
        emit JobPosted(_jobs.length - 1, msg.sender, specURI, reward, deadlineHours);
        return _jobs.length - 1;
    }

    function claimJob(uint256 jobId) external {
        Job storage j = _jobs[jobId];
        require(j.state == 0, "Not open");
        j.worker = msg.sender;
        j.state = 1;
        j.claimedAt = uint64(block.timestamp);
        emit JobClaimed(jobId, msg.sender);
    }

    function submitJob(uint256 jobId, string calldata resultURI) external {
        Job storage j = _jobs[jobId];
        require(j.state == 1, "Not claimed");
        require(msg.sender == j.worker, "Worker only");
        require(block.timestamp <= j.claimedAt + j.deadlineHours * 1 hours, "Past deadline");
        require(bytes(resultURI).length > 0, "Empty result");
        j.resultURI = resultURI;
        j.state = 2;
        j.submittedAt = uint64(block.timestamp);
        emit JobSubmitted(jobId, msg.sender, resultURI);
    }

    function approveJob(uint256 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        require(j.state == 2, "Not submitted");
        require(msg.sender == j.poster, "Poster only");
        _pay(j, j.worker);
        completedJobs[j.worker] += 1;
        emit JobApproved(jobId, j.worker, j.reward - j.reward * PLATFORM_FEE_BPS / 10000);
    }

    function disputeJob(uint256 jobId) external {
        Job storage j = _jobs[jobId];
        require(j.state == 2, "Not submitted");
        require(msg.sender == j.poster, "Poster only");
        require(block.timestamp <= j.submittedAt + SETTLEMENT_TIMEOUT, "Settlement window closed");
        j.state = 5;
        emit JobDisputed(jobId, msg.sender);
    }

    function resolveDispute(uint256 jobId, bool workerWins) external onlyOwner nonReentrant {
        Job storage j = _jobs[jobId];
        require(j.state == 5, "Not disputed");
        if (workerWins) {
            _pay(j, j.worker);
            completedJobs[j.worker] += 1;
        } else {
            j.state = 4;
            slashedJobs[j.worker] += 1;
            rewardToken.safeTransfer(j.poster, j.reward);
        }
        emit JobResolved(jobId, workerWins, msg.sender);
    }

    /// Trust-minimized settlement: if the poster goes silent for SETTLEMENT_TIMEOUT
    /// after a submission, the worker can release their own payout.
    function timeoutSettle(uint256 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        require(j.state == 2, "Not submitted");
        require(msg.sender == j.worker, "Worker only");
        require(block.timestamp > j.submittedAt + SETTLEMENT_TIMEOUT, "Too early");
        _pay(j, j.worker);
        completedJobs[j.worker] += 1;
        emit JobTimedOut(jobId, msg.sender, j.reward - j.reward * PLATFORM_FEE_BPS / 10000);
    }

    function cancelJob(uint256 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        require(j.state == 0, "Not open");
        require(msg.sender == j.poster, "Poster only");
        j.state = 4;
        rewardToken.safeTransfer(j.poster, j.reward);
        emit JobCancelled(jobId, msg.sender);
    }

    function _pay(Job storage j, address worker) internal {
        j.state = 3;
        uint256 fee = j.reward * PLATFORM_FEE_BPS / 10000;
        uint256 payout = j.reward - fee;
        totalRewarded += payout;
        rewardToken.safeTransfer(treasury, fee);
        rewardToken.safeTransfer(worker, payout);
    }

    function getJob(uint256 jobId)
        external
        view
        returns (address poster, string memory specURI, uint256 reward, uint32 deadlineHours, address worker, string memory resultURI, uint8 state, uint64 claimedAt, uint64 submittedAt)
    {
        Job storage j = _jobs[jobId];
        return (j.poster, j.specURI, j.reward, j.deadlineHours, j.worker, j.resultURI, j.state, j.claimedAt, j.submittedAt);
    }
}
