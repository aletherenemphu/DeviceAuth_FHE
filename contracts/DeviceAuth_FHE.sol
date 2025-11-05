pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DeviceAuthFHE is ZamaEthereumConfig {
    struct Device {
        bytes32 encryptedId;
        uint256 publicKey;
        address owner;
        bool isActive;
        uint256 lastAuthTime;
    }

    mapping(bytes32 => Device) private devices;
    mapping(address => bytes32[]) private ownerDevices;

    event DeviceRegistered(bytes32 indexed encryptedId, address indexed owner);
    event DeviceAuthenticated(bytes32 indexed encryptedId, uint256 authTime);

    modifier onlyValidProof(bytes memory proof) {
        require(proof.length > 0, "Invalid proof");
        _;
    }

    constructor() ZamaEthereumConfig() {}

    function registerDevice(
        externalEuint32 encryptedId,
        bytes calldata registrationProof,
        uint256 publicKey
    ) external onlyValidProof(registrationProof) {
        bytes32 idHash = keccak256(abi.encodePacked(encryptedId));
        require(devices[idHash].owner == address(0), "Device already registered");

        euint32 internalEncryptedId = FHE.fromExternal(encryptedId, registrationProof);
        require(FHE.isInitialized(internalEncryptedId), "Invalid encrypted ID");

        address owner = msg.sender;
        devices[idHash] = Device({
            encryptedId: FHE.toBytes32(internalEncryptedId),
            publicKey: publicKey,
            owner: owner,
            isActive: true,
            lastAuthTime: 0
        });

        ownerDevices[owner].push(idHash);
        FHE.allowThis(internalEncryptedId);
        FHE.makePubliclyDecryptable(internalEncryptedId);

        emit DeviceRegistered(idHash, owner);
    }

    function authenticateDevice(
        bytes32 encryptedId,
        bytes calldata authProof,
        uint256 authTimestamp
    ) external onlyValidProof(authProof) {
        Device storage device = devices[encryptedId];
        require(device.owner != address(0), "Device not found");
        require(device.isActive, "Device inactive");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = device.encryptedId;

        bytes memory abiEncoded = abi.encode(authTimestamp);
        FHE.checkSignatures(cts, abiEncoded, authProof);

        device.lastAuthTime = authTimestamp;
        emit DeviceAuthenticated(encryptedId, authTimestamp);
    }

    function getDevice(bytes32 encryptedId) external view returns (
        uint256 publicKey,
        address owner,
        bool isActive,
        uint256 lastAuthTime
    ) {
        Device storage device = devices[encryptedId];
        require(device.owner != address(0), "Device not found");
        return (device.publicKey, device.owner, device.isActive, device.lastAuthTime);
    }

    function getOwnerDevices() external view returns (bytes32[] memory) {
        return ownerDevices[msg.sender];
    }

    function deactivateDevice(bytes32 encryptedId) external {
        Device storage device = devices[encryptedId];
        require(device.owner == msg.sender, "Not device owner");
        device.isActive = false;
    }

    function verifyDeviceOwnership(
        bytes32 encryptedId,
        bytes calldata ownershipProof
    ) external view onlyValidProof(ownershipProof) returns (bool) {
        Device storage device = devices[encryptedId];
        require(device.owner != address(0), "Device not found");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = device.encryptedId;

        bytes memory abiEncoded = abi.encode(device.owner);
        return FHE.checkSignatures(cts, abiEncoded, ownershipProof);
    }

    function getEncryptedId(bytes32 encryptedId) external view returns (bytes32) {
        Device storage device = devices[encryptedId];
        require(device.owner != address(0), "Device not found");
        return device.encryptedId;
    }
}

