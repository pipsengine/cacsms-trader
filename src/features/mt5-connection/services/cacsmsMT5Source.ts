import type { MT5ConnectionSource } from '../types/mt5.types';
import {
  getMT5Snapshot,
  mt5Connect,
  mt5Disconnect,
  mt5EmergencyStop,
  mt5Reconcile,
  mt5Reconnect,
  mt5SaveAccount,
  mt5SaveSymbolMap,
  mt5SetAccountTrading,
  mt5SetGlobalTrading,
  mt5TestConnection,
  subscribeMT5,
} from './cacsmsMT5Runtime';

/** Production-integrated MT5 source bound to Cacsms runtime services (event bus, audit, Stage 9 gateway). */
export function createCacsmsMT5Source(): MT5ConnectionSource {
  return {
    getSnapshot: () => getMT5Snapshot(),
    subscribe: subscribeMT5,
    connect: mt5Connect,
    disconnect: mt5Disconnect,
    reconnect: mt5Reconnect,
    testConnection: mt5TestConnection,
    saveAccount: mt5SaveAccount,
    setAccountTrading: mt5SetAccountTrading,
    setGlobalTrading: mt5SetGlobalTrading,
    saveSymbolMap: mt5SaveSymbolMap,
    reconcile: mt5Reconcile,
    emergencyStop: mt5EmergencyStop,
  };
}
