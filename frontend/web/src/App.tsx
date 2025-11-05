import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface IoTDevice {
  id: string;
  name: string;
  status: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
  deviceType: string;
  location: string;
  battery: number;
}

interface DeviceStats {
  totalDevices: number;
  verifiedDevices: number;
  activeDevices: number;
  averageBattery: number;
  encryptionRate: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<IoTDevice[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingDevice, setAddingDevice] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newDeviceData, setNewDeviceData] = useState({ 
    name: "", 
    deviceId: "", 
    value: "", 
    deviceType: "sensor", 
    location: "gateway-1",
    battery: 100 
  });
  const [selectedDevice, setSelectedDevice] = useState<IoTDevice | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [operationHistory, setOperationHistory] = useState<string[]>([]);
  const [stats, setStats] = useState<DeviceStats>({
    totalDevices: 0,
    verifiedDevices: 0,
    activeDevices: 0,
    averageBattery: 0,
    encryptionRate: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [contractAddress, setContractAddress] = useState("");

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        console.log('Initializing FHEVM for IoT device authentication...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadDevices();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const addToHistory = (message: string) => {
    setOperationHistory(prev => [`[${new Date().toLocaleTimeString()}] ${message}`, ...prev.slice(0, 9)]);
  };

  const loadDevices = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const devicesList: IoTDevice[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          devicesList.push({
            id: businessId,
            name: businessData.name,
            status: businessData.isVerified ? "verified" : "pending",
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            deviceType: ["sensor", "actuator", "gateway", "controller"][Math.floor(Math.random() * 4)],
            location: ["gateway-1", "gateway-2", "edge-node", "cloud"][Math.floor(Math.random() * 4)],
            battery: Math.floor(Math.random() * 100) + 1
          });
        } catch (e) {
          console.error('Error loading device data:', e);
        }
      }
      
      setDevices(devicesList);
      updateStats(devicesList);
      addToHistory(`Loaded ${devicesList.length} devices from blockchain`);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load devices" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (deviceList: IoTDevice[]) => {
    const total = deviceList.length;
    const verified = deviceList.filter(d => d.isVerified).length;
    const active = deviceList.filter(d => d.battery > 20).length;
    const avgBattery = deviceList.length > 0 ? deviceList.reduce((sum, d) => sum + d.battery, 0) / deviceList.length : 0;
    const encryptionRate = deviceList.length > 0 ? (verified / total) * 100 : 0;

    setStats({
      totalDevices: total,
      verifiedDevices: verified,
      activeDevices: active,
      averageBattery: avgBattery,
      encryptionRate: encryptionRate
    });
  };

  const addDevice = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setAddingDevice(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting device data with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const deviceValue = parseInt(newDeviceData.value) || 0;
      const businessId = `device-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, deviceValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newDeviceData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        newDeviceData.battery,
        0,
        `${newDeviceData.deviceType} device at ${newDeviceData.location}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Adding device to blockchain..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Device added successfully!" });
      addToHistory(`Added device: ${newDeviceData.name} with FHE encryption`);
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadDevices();
      setShowAddModal(false);
      setNewDeviceData({ 
        name: "", 
        deviceId: "", 
        value: "", 
        deviceType: "sensor", 
        location: "gateway-1",
        battery: 100 
      });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Failed to add device: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setAddingDevice(false); 
    }
  };

  const decryptDeviceData = async (deviceId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(deviceId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Device already verified on-chain" 
        });
        addToHistory(`Device ${deviceId} data already verified`);
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(deviceId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(deviceId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying device authentication..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadDevices();
      addToHistory(`Device ${deviceId} authenticated with FHE verification`);
      
      setTransactionStatus({ visible: true, status: "success", message: "Device authenticated successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Device is already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadDevices();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Authentication failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and responding" 
      });
      addToHistory("Checked contract availability: OK");
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredDevices = devices.filter(device => {
    const matchesSearch = device.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         device.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "all" || 
                         (filterStatus === "verified" && device.isVerified) ||
                         (filterStatus === "pending" && !device.isVerified);
    return matchesSearch && matchesStatus;
  });

  const renderStatsPanel = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card metal-shine">
          <div className="stat-icon">🔢</div>
          <div className="stat-content">
            <h3>Total Devices</h3>
            <div className="stat-value">{stats.totalDevices}</div>
            <div className="stat-trend">FHE Protected</div>
          </div>
        </div>
        
        <div className="stat-card metal-shine">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <h3>Verified</h3>
            <div className="stat-value">{stats.verifiedDevices}/{stats.totalDevices}</div>
            <div className="stat-trend">Authenticated</div>
          </div>
        </div>
        
        <div className="stat-card metal-shine">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <h3>Active</h3>
            <div className="stat-value">{stats.activeDevices}</div>
            <div className="stat-trend">Online</div>
          </div>
        </div>
        
        <div className="stat-card metal-shine">
          <div className="stat-icon">🔋</div>
          <div className="stat-content">
            <h3>Avg Battery</h3>
            <div className="stat-value">{stats.averageBattery.toFixed(1)}%</div>
            <div className="stat-trend">Health</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step metal-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>Device Registration</h4>
            <p>IoT device ID encrypted with FHE 🔐</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step metal-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>Gateway Authentication</h4>
            <p>Homomorphic verification at edge gateway</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step metal-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>Zero-Knowledge Proof</h4>
            <p>Privacy-preserving device validation</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step metal-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>On-chain Verification</h4>
            <p>Immutable authentication record</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header metal-header">
          <div className="logo">
            <h1>🔐 Private IoT Auth</h1>
            <span>FHE-Enhanced Device Security</span>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt metal-bg">
          <div className="connection-content">
            <div className="connection-icon">🛡️</div>
            <h2>Secure IoT Device Authentication</h2>
            <p>Connect your wallet to manage FHE-protected IoT devices with homomorphic encryption</p>
            <div className="connection-steps">
              <div className="step metal-step">
                <span>1</span>
                <p>Connect wallet for device management</p>
              </div>
              <div className="step metal-step">
                <span>2</span>
                <p>Initialize FHE encryption system</p>
              </div>
              <div className="step metal-step">
                <span>3</span>
                <p>Add and authenticate IoT devices</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen metal-bg">
        <div className="fhe-spinner metal-spinner"></div>
        <p>Initializing FHE Security System...</p>
        <p className="loading-note">Encrypting device authentication pipeline</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen metal-bg">
      <div className="fhe-spinner metal-spinner"></div>
      <p>Loading IoT Device Registry...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header metal-header">
        <div className="logo">
          <h1>🛡️ IoT Device Auth</h1>
          <span>FHE-Protected Authentication</span>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn metal-btn">
            Test Contract
          </button>
          <button onClick={() => setShowAddModal(true)} className="add-btn metal-btn">
            + Add Device
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section metal-panel">
          <h2>IoT Security Dashboard</h2>
          {renderStatsPanel()}
          
          <div className="fhe-section metal-panel">
            <h3>FHE Authentication Flow</h3>
            {renderFHEFlow()}
          </div>
        </div>
        
        <div className="devices-section">
          <div className="section-header">
            <h2>Registered Devices</h2>
            <div className="controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search devices..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="metal-input"
                />
              </div>
              <select 
                value={filterStatus} 
                onChange={(e) => setFilterStatus(e.target.value)}
                className="metal-select"
              >
                <option value="all">All Devices</option>
                <option value="verified">Verified</option>
                <option value="pending">Pending</option>
              </select>
              <button onClick={loadDevices} className="refresh-btn metal-btn" disabled={isRefreshing}>
                {isRefreshing ? "🔄" : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="devices-grid">
            {filteredDevices.length === 0 ? (
              <div className="no-devices metal-panel">
                <p>No IoT devices found</p>
                <button className="add-btn metal-btn" onClick={() => setShowAddModal(true)}>
                  Register First Device
                </button>
              </div>
            ) : filteredDevices.map((device) => (
              <DeviceCard 
                key={device.id} 
                device={device} 
                onSelect={setSelectedDevice}
                onAuthenticate={decryptDeviceData}
              />
            ))}
          </div>
        </div>

        <div className="history-section metal-panel">
          <h3>Operation History</h3>
          <div className="history-list">
            {operationHistory.map((entry, index) => (
              <div key={index} className="history-entry metal-entry">
                {entry}
              </div>
            ))}
            {operationHistory.length === 0 && (
              <div className="no-history">No operations recorded</div>
            )}
          </div>
        </div>
      </div>
      
      {showAddModal && (
        <AddDeviceModal 
          onSubmit={addDevice} 
          onClose={() => setShowAddModal(false)} 
          adding={addingDevice} 
          deviceData={newDeviceData} 
          setDeviceData={setNewDeviceData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedDevice && (
        <DeviceDetailModal 
          device={selectedDevice} 
          onClose={() => setSelectedDevice(null)} 
          onAuthenticate={decryptDeviceData}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-panel">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner metal-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const DeviceCard: React.FC<{ 
  device: IoTDevice; 
  onSelect: (device: IoTDevice) => void;
  onAuthenticate: (deviceId: string) => Promise<number | null>;
}> = ({ device, onSelect, onAuthenticate }) => {
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const handleAuthenticate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsAuthenticating(true);
    await onAuthenticate(device.id);
    setIsAuthenticating(false);
  };

  return (
    <div className="device-card metal-card" onClick={() => onSelect(device)}>
      <div className="device-header">
        <div className="device-name">{device.name}</div>
        <div className={`device-status ${device.status} metal-badge`}>
          {device.isVerified ? "✅ Verified" : "🔒 Pending"}
        </div>
      </div>
      
      <div className="device-info">
        <div className="info-row">
          <span>Type:</span>
          <span className="device-type">{device.deviceType}</span>
        </div>
        <div className="info-row">
          <span>Location:</span>
          <span>{device.location}</span>
        </div>
        <div className="info-row">
          <span>Battery:</span>
          <div className="battery-bar">
            <div 
              className={`battery-fill ${device.battery > 50 ? 'high' : device.battery > 20 ? 'medium' : 'low'}`}
              style={{ width: `${device.battery}%` }}
            ></div>
            <span>{device.battery}%</span>
          </div>
        </div>
      </div>
      
      <div className="device-actions">
        <button 
          className={`auth-btn metal-btn ${device.isVerified ? 'verified' : ''}`}
          onClick={handleAuthenticate}
          disabled={isAuthenticating}
        >
          {isAuthenticating ? "🔓..." : device.isVerified ? "✅ Verified" : "🔓 Authenticate"}
        </button>
      </div>
    </div>
  );
};

const AddDeviceModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  adding: boolean;
  deviceData: any;
  setDeviceData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, adding, deviceData, setDeviceData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'value') {
      const intValue = value.replace(/[^\d]/g, '');
      setDeviceData({ ...deviceData, [name]: intValue });
    } else {
      setDeviceData({ ...deviceData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="add-device-modal metal-modal">
        <div className="modal-header">
          <h2>Register IoT Device</h2>
          <button onClick={onClose} className="close-modal metal-close">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice metal-notice">
            <strong>FHE 🔐 Device Authentication</strong>
            <p>Device identity will be encrypted with homomorphic encryption</p>
          </div>
          
          <div className="form-group">
            <label>Device Name *</label>
            <input 
              type="text" 
              name="name" 
              value={deviceData.name} 
              onChange={handleChange} 
              placeholder="Enter device name..." 
              className="metal-input"
            />
          </div>
          
          <div className="form-group">
            <label>Device ID Value (Integer) *</label>
            <input 
              type="number" 
              name="value" 
              value={deviceData.value} 
              onChange={handleChange} 
              placeholder="Enter unique device ID..." 
              step="1"
              min="0"
              className="metal-input"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>Device Type</label>
              <select name="deviceType" value={deviceData.deviceType} onChange={handleChange} className="metal-select">
                <option value="sensor">Sensor</option>
                <option value="actuator">Actuator</option>
                <option value="gateway">Gateway</option>
                <option value="controller">Controller</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Location</label>
              <select name="location" value={deviceData.location} onChange={handleChange} className="metal-select">
                <option value="gateway-1">Gateway 1</option>
                <option value="gateway-2">Gateway 2</option>
                <option value="edge-node">Edge Node</option>
                <option value="cloud">Cloud</option>
              </select>
            </div>
          </div>
          
          <div className="form-group">
            <label>Battery Level: {deviceData.battery}%</label>
            <input 
              type="range" 
              name="battery" 
              min="0" 
              max="100" 
              value={deviceData.battery} 
              onChange={handleChange}
              className="metal-slider"
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={adding || isEncrypting || !deviceData.name || !deviceData.value} 
            className="submit-btn metal-btn"
          >
            {adding || isEncrypting ? "Encrypting..." : "Register Device"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DeviceDetailModal: React.FC<{
  device: IoTDevice;
  onClose: () => void;
  onAuthenticate: (deviceId: string) => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ device, onClose, onAuthenticate, isDecrypting }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleAuthenticate = async () => {
    const result = await onAuthenticate(device.id);
    if (result !== null) {
      setLocalDecrypted(result);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="device-detail-modal metal-modal">
        <div className="modal-header">
          <h2>Device Details</h2>
          <button onClick={onClose} className="close-modal metal-close">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="device-info-grid">
            <div className="info-item">
              <span>Device Name:</span>
              <strong>{device.name}</strong>
            </div>
            <div className="info-item">
              <span>Device ID:</span>
              <strong>{device.id}</strong>
            </div>
            <div className="info-item">
              <span>Type:</span>
              <span className="device-type-badge">{device.deviceType}</span>
            </div>
            <div className="info-item">
              <span>Location:</span>
              <strong>{device.location}</strong>
            </div>
            <div className="info-item">
              <span>Battery:</span>
              <div className="battery-display">
                <div className="battery-level">
                  <div 
                    className={`battery-fill ${device.battery > 50 ? 'high' : device.battery > 20 ? 'medium' : 'low'}`}
                    style={{ width: `${device.battery}%` }}
                  ></div>
                </div>
                <span>{device.battery}%</span>
              </div>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <span className={`status-badge ${device.isVerified ? 'verified' : 'pending'}`}>
                {device.isVerified ? '✅ Verified' : '🔒 Pending Authentication'}
              </span>
            </div>
          </div>
          
          <div className="authentication-section">
            <h3>FHE Authentication</h3>
            <div className="auth-status">
              <div className="auth-info">
                <div className="encrypted-value">
                  <strong>Encrypted Device ID:</strong>
                  <span>🔐 FHE Protected Integer</span>
                </div>
                <div className="decrypted-value">
                  <strong>Decrypted Value:</strong>
                  <span>
                    {device.isVerified ? 
                      `${device.decryptedValue} (On-chain Verified)` : 
                      localDecrypted !== null ? 
                      `${localDecrypted} (Locally Decrypted)` : 
                      "🔒 Encrypted"
                    }
                  </span>
                </div>
              </div>
              
              <button 
                className={`auth-btn large metal-btn ${device.isVerified ? 'verified' : ''}`}
                onClick={handleAuthenticate}
                disabled={isDecrypting}
              >
                {isDecrypting ? "Authenticating..." : 
                 device.isVerified ? "✅ Verified" : 
                 "🔓 Authenticate Device"}
              </button>
            </div>
          </div>
          
          <div className="device-description">
            <h3>Description</h3>
            <p>{device.description}</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;

