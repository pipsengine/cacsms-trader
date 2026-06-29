//+------------------------------------------------------------------+
//| Cacsms Trader EA                                                 |
//| Demo heartbeat bridge first, execution later.                     |
//+------------------------------------------------------------------+
#property strict
#property version "001.007"

#include <Trade\Trade.mqh>

input string TerminalId = "UNCONFIGURED";
input string BridgeUrl = "http://127.0.0.1:8787";
input string BridgeSecret = "mt5_cacsms";
input int HeartbeatSeconds = 5;
input int CommandPollSeconds = 2;
input bool EnableExecution = false;
input long MagicNumber = 9902501;
input int SlippagePoints = 20;
input int WebRequestTimeoutMs = 5000;
input bool EnableBasketProfitLock = true;
input double BasketLockTier1TriggerUsd = 20.0;
input double BasketLockTier1FloorUsd = 20.0;
input double BasketLockTier2TriggerUsd = 50.0;
input double BasketLockTier2FloorUsd = 40.0;
input double BasketLockTier3TriggerUsd = 100.0;
input double BasketLockTier3FloorUsd = 80.0;
input int BasketLockLogSeconds = 5;

#define MAX_BASKET_GROUPS 8

CTrade trade;

datetime lastHeartbeat = 0;
datetime eaStartedAt = 0;
long heartbeatSequence = 0;
int lastWebRequestLatencyMs = 0;
datetime lastCommandPoll = 0;
string currentCommandId = "";
string currentCommandTerminalId = "";
ulong pendingOrderTickets[32];
string pendingOrderCommandIds[32];
string pendingOrderTerminalIds[32];
string pendingOrderTypes[32];
int pendingOrderCount = 0;

bool virtualEntryActive[32];
string virtualEntryCommandIds[32];
string virtualEntryTerminalIds[32];
string virtualEntrySymbols[32];
string virtualEntrySides[32];
ENUM_TIMEFRAMES virtualEntryTimeframes[32];
double virtualEntryVolumes[32];
double virtualEntryPrices[32];
double virtualEntryStopLosses[32];
double virtualEntryTakeProfits[32];
double virtualEntryCancelPrices[32];
string virtualEntryComments[32];
int virtualEntryCount = 0;

string g_basketGroupKeys[MAX_BASKET_GROUPS];
double g_basketPeakUsd[MAX_BASKET_GROUPS];
double g_basketLockedUsd[MAX_BASKET_GROUPS];
double g_basketFloatUsd[MAX_BASKET_GROUPS];
int g_basketLegCount[MAX_BASKET_GROUPS];
string g_basketSymbols[MAX_BASKET_GROUPS];
string g_basketSides[MAX_BASKET_GROUPS];
double g_basketLastTargetSl[MAX_BASKET_GROUPS];
int g_basketLastModifyFailures[MAX_BASKET_GROUPS];
datetime g_basketLastProtectionTick[MAX_BASKET_GROUPS];
string g_basketLastProtectionStatus[MAX_BASKET_GROUPS];
int g_basketGroupCount = 0;
string g_basketProtectionJson = "[]";
datetime g_lastBasketLogAt = 0;

string BoolToString(bool value)
{
   return value ? "true" : "false";
}

string TruncateString(string value, int maxLen)
{
   if (maxLen <= 0) return "";
   if (StringLen(value) <= maxLen) return value;
   return StringSubstr(value, 0, maxLen) + "...";
}

int FindPendingIndex(ulong orderTicket)
{
   for (int i = 0; i < pendingOrderCount; i++)
   {
      if (pendingOrderTickets[i] == orderTicket) return i;
   }
   return -1;
}

void AddPending(ulong orderTicket, string commandId, string terminalId)
{
   if (orderTicket <= 0) return;
   if (commandId == "") return;
   int existing = FindPendingIndex(orderTicket);
   if (existing >= 0)
   {
      pendingOrderCommandIds[existing] = commandId;
      pendingOrderTerminalIds[existing] = terminalId;
      return;
   }
   if (pendingOrderCount >= 32) return;
   pendingOrderTickets[pendingOrderCount] = orderTicket;
   pendingOrderCommandIds[pendingOrderCount] = commandId;
   pendingOrderTerminalIds[pendingOrderCount] = terminalId;
   pendingOrderTypes[pendingOrderCount] = "PLACE_ORDER";
   pendingOrderCount++;
}

void RemovePendingAt(int index)
{
   if (index < 0 || index >= pendingOrderCount) return;
   int last = pendingOrderCount - 1;
   pendingOrderTickets[index] = pendingOrderTickets[last];
   pendingOrderCommandIds[index] = pendingOrderCommandIds[last];
   pendingOrderTerminalIds[index] = pendingOrderTerminalIds[last];
   pendingOrderTypes[index] = pendingOrderTypes[last];
   pendingOrderTickets[last] = 0;
   pendingOrderCommandIds[last] = "";
   pendingOrderTerminalIds[last] = "";
   pendingOrderTypes[last] = "";
   pendingOrderCount--;
}

void RemoveVirtualEntryAt(int index)
{
   if (index < 0 || index >= virtualEntryCount) return;
   int last = virtualEntryCount - 1;
   virtualEntryActive[index] = virtualEntryActive[last];
   virtualEntryCommandIds[index] = virtualEntryCommandIds[last];
   virtualEntryTerminalIds[index] = virtualEntryTerminalIds[last];
   virtualEntrySymbols[index] = virtualEntrySymbols[last];
   virtualEntrySides[index] = virtualEntrySides[last];
   virtualEntryTimeframes[index] = virtualEntryTimeframes[last];
   virtualEntryVolumes[index] = virtualEntryVolumes[last];
   virtualEntryPrices[index] = virtualEntryPrices[last];
   virtualEntryStopLosses[index] = virtualEntryStopLosses[last];
   virtualEntryTakeProfits[index] = virtualEntryTakeProfits[last];
   virtualEntryCancelPrices[index] = virtualEntryCancelPrices[last];
   virtualEntryComments[index] = virtualEntryComments[last];
   virtualEntryActive[last] = false;
   virtualEntryCommandIds[last] = "";
   virtualEntryTerminalIds[last] = "";
   virtualEntrySymbols[last] = "";
   virtualEntrySides[last] = "";
   virtualEntryVolumes[last] = 0.0;
   virtualEntryPrices[last] = 0.0;
   virtualEntryStopLosses[last] = 0.0;
   virtualEntryTakeProfits[last] = 0.0;
   virtualEntryCancelPrices[last] = 0.0;
   virtualEntryComments[last] = "";
   virtualEntryCount--;
}

bool AddVirtualEntry(string commandId, string terminalId, string symbol, string side, ENUM_TIMEFRAMES timeframe, double volume, double entryPrice, double stopLoss, double takeProfit, double cancelPrice, string comment)
{
   if (virtualEntryCount >= 32 || commandId == "" || symbol == "" || entryPrice <= 0.0 || volume <= 0.0) return false;
   virtualEntryActive[virtualEntryCount] = true;
   virtualEntryCommandIds[virtualEntryCount] = commandId;
   virtualEntryTerminalIds[virtualEntryCount] = terminalId;
   virtualEntrySymbols[virtualEntryCount] = symbol;
   virtualEntrySides[virtualEntryCount] = side;
   virtualEntryTimeframes[virtualEntryCount] = timeframe;
   virtualEntryVolumes[virtualEntryCount] = volume;
   virtualEntryPrices[virtualEntryCount] = entryPrice;
   virtualEntryStopLosses[virtualEntryCount] = stopLoss;
   virtualEntryTakeProfits[virtualEntryCount] = takeProfit;
   virtualEntryCancelPrices[virtualEntryCount] = cancelPrice;
   virtualEntryComments[virtualEntryCount] = comment;
   virtualEntryCount++;
   return true;
}

bool IsGoldBasketSymbol(string symbol)
{
   string upper = symbol;
   StringToUpper(upper);
   return (StringFind(upper, "XAU") == 0 || StringFind(upper, "XAG") == 0);
}

bool IsManagedBasketPosition(ulong ticket)
{
   if (ticket <= 0 || !PositionSelectByTicket(ticket)) return false;
   if ((ulong)PositionGetInteger(POSITION_MAGIC) != (ulong)MagicNumber) return false;
   return IsGoldBasketSymbol(PositionGetString(POSITION_SYMBOL));
}

int FindBasketGroupIndex(string basketKey)
{
   for (int i = 0; i < g_basketGroupCount; i++)
   {
      if (g_basketGroupKeys[i] == basketKey) return i;
   }
   return -1;
}

int EnsureBasketGroupIndex(string basketKey)
{
   int index = FindBasketGroupIndex(basketKey);
   if (index >= 0) return index;
   if (g_basketGroupCount >= MAX_BASKET_GROUPS) return -1;
   index = g_basketGroupCount;
   g_basketGroupKeys[index] = basketKey;
   g_basketPeakUsd[index] = 0.0;
   g_basketLockedUsd[index] = 0.0;
   g_basketFloatUsd[index] = 0.0;
   g_basketLegCount[index] = 0;
   g_basketSymbols[index] = "";
   g_basketSides[index] = "";
   g_basketLastTargetSl[index] = 0.0;
   g_basketLastModifyFailures[index] = 0;
   g_basketLastProtectionTick[index] = 0;
   g_basketLastProtectionStatus[index] = "inactive";
   g_basketGroupCount++;
   return index;
}

void ResetBasketGroupAt(int index)
{
   if (index < 0 || index >= g_basketGroupCount) return;
   g_basketPeakUsd[index] = 0.0;
   g_basketLockedUsd[index] = 0.0;
   g_basketFloatUsd[index] = 0.0;
   g_basketLegCount[index] = 0;
   g_basketLastTargetSl[index] = 0.0;
   g_basketLastModifyFailures[index] = 0;
   g_basketLastProtectionTick[index] = 0;
   g_basketLastProtectionStatus[index] = "inactive";
}

double ResolveBasketLockedUsd(double peakUsd, double currentLockedUsd)
{
   double locked = MathMax(0.0, currentLockedUsd);
   if (peakUsd + 1e-6 >= BasketLockTier3TriggerUsd) locked = MathMax(locked, BasketLockTier3FloorUsd);
   else if (peakUsd + 1e-6 >= BasketLockTier2TriggerUsd) locked = MathMax(locked, BasketLockTier2FloorUsd);
   else if (peakUsd + 1e-6 >= BasketLockTier1TriggerUsd) locked = MathMax(locked, BasketLockTier1FloorUsd);
   return locked;
}

bool CloseBasketGroup(string symbol, long positionType)
{
   trade.SetExpertMagicNumber((ulong)MagicNumber);
   trade.SetDeviationInPoints(SlippagePoints);
   bool closedAny = false;
   for (int pass = 0; pass < 2; pass++)
   {
      for (int i = PositionsTotal() - 1; i >= 0; i--)
      {
         ulong ticket = PositionGetTicket(i);
         if (!IsManagedBasketPosition(ticket)) continue;
         if (PositionGetString(POSITION_SYMBOL) != symbol) continue;
         if (PositionGetInteger(POSITION_TYPE) != positionType) continue;
         if (!trade.PositionClose(ticket))
         {
            Print("[BASKET_LOCK] close_failed ticket=", ticket, " symbol=", symbol, " retcode=", trade.ResultRetcode(), " detail=", trade.ResultRetcodeDescription());
            continue;
         }
         closedAny = true;
         Print("[BASKET_LOCK] closed ticket=", ticket, " symbol=", symbol);
      }
   }
   return closedAny;
}

double BasketMoneyPerPriceUnit(string symbol, double volume)
{
   double tickSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   if (tickSize <= 0.0 || tickValue <= 0.0 || volume <= 0.0) return 0.0;
   return (tickValue / tickSize) * volume;
}

double NormalizeBrokerStop(string symbol, long positionType, double requestedSl)
{
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   int stopLevel = (int)SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double bid = 0.0;
   double ask = 0.0;
   SymbolInfoDouble(symbol, SYMBOL_BID, bid);
   SymbolInfoDouble(symbol, SYMBOL_ASK, ask);

   double minDistance = MathMax(point, (stopLevel + 2) * point);
   double sl = requestedSl;
   if (positionType == POSITION_TYPE_BUY && bid > 0.0)
      sl = MathMin(sl, bid - minDistance);
   if (positionType == POSITION_TYPE_SELL && ask > 0.0)
      sl = MathMax(sl, ask + minDistance);
   return NormalizeDouble(sl, digits);
}

bool ResolveBasketLockStopLoss(string symbol, long positionType, double lockedUsd, double &targetSl)
{
   if (lockedUsd <= 0.0) return false;

   double weightedEntry = 0.0;
   double moneyPerPrice = 0.0;
   int legCount = 0;
   for (int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if (!IsManagedBasketPosition(ticket)) continue;
      if (PositionGetString(POSITION_SYMBOL) != symbol) continue;
      if (PositionGetInteger(POSITION_TYPE) != positionType) continue;

      double volume = PositionGetDouble(POSITION_VOLUME);
      double perPrice = BasketMoneyPerPriceUnit(symbol, volume);
      if (perPrice <= 0.0) continue;
      weightedEntry += PositionGetDouble(POSITION_PRICE_OPEN) * perPrice;
      moneyPerPrice += perPrice;
      legCount++;
   }

   if (legCount <= 0 || moneyPerPrice <= 0.0) return false;

   double rawSl = positionType == POSITION_TYPE_BUY
      ? (lockedUsd + weightedEntry) / moneyPerPrice
      : (weightedEntry - lockedUsd) / moneyPerPrice;
   targetSl = NormalizeBrokerStop(symbol, positionType, rawSl);
   return targetSl > 0.0;
}

bool PositionNeedsBasketSlMove(long positionType, double currentSl, double targetSl)
{
   if (targetSl <= 0.0) return false;
   if (positionType == POSITION_TYPE_BUY) return currentSl <= 0.0 || targetSl > currentSl + 1e-8;
   return currentSl <= 0.0 || targetSl < currentSl - 1e-8;
}

bool ApplyBasketProtectionStopLoss(int groupIndex)
{
   if (groupIndex < 0 || groupIndex >= g_basketGroupCount) return false;
   if (g_basketLockedUsd[groupIndex] <= 0.0 || g_basketLegCount[groupIndex] <= 0) return true;

   string symbol = g_basketSymbols[groupIndex];
   long positionType = g_basketSides[groupIndex] == "buy" ? POSITION_TYPE_BUY : POSITION_TYPE_SELL;
   double targetSl = 0.0;
   if (!ResolveBasketLockStopLoss(symbol, positionType, g_basketLockedUsd[groupIndex], targetSl))
   {
      g_basketLastModifyFailures[groupIndex]++;
      g_basketLastProtectionTick[groupIndex] = TimeLocal();
      g_basketLastProtectionStatus[groupIndex] = "sl_target_unavailable";
      Print("[BASKET_LOCK] sl_target_unavailable symbol=", symbol, " side=", g_basketSides[groupIndex], " lock=", DoubleToString(g_basketLockedUsd[groupIndex], 2));
      return false;
   }

   trade.SetExpertMagicNumber((ulong)MagicNumber);
   trade.SetDeviationInPoints(SlippagePoints);

   bool anyNeeded = false;
   bool anyFailed = false;
   int modified = 0;
   for (int pass = 0; pass < 2; pass++)
   {
      anyFailed = false;
      for (int i = PositionsTotal() - 1; i >= 0; i--)
      {
         ulong ticket = PositionGetTicket(i);
         if (!IsManagedBasketPosition(ticket)) continue;
         if (PositionGetString(POSITION_SYMBOL) != symbol) continue;
         if (PositionGetInteger(POSITION_TYPE) != positionType) continue;

         double currentSl = PositionGetDouble(POSITION_SL);
         double currentTp = PositionGetDouble(POSITION_TP);
         if (!PositionNeedsBasketSlMove(positionType, currentSl, targetSl)) continue;
         anyNeeded = true;

         ResetLastError();
         if (!trade.PositionModify(ticket, targetSl, currentTp))
         {
            anyFailed = true;
            Print("[BASKET_LOCK] sl_modify_failed ticket=", ticket,
                  " symbol=", symbol,
                  " targetSl=", DoubleToString(targetSl, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS)),
                  " retcode=", trade.ResultRetcode(),
                  " detail=", trade.ResultRetcodeDescription(),
                  " pass=", pass + 1);
         }
         else
         {
            modified++;
            Print("[BASKET_LOCK] sl_modified ticket=", ticket,
                  " symbol=", symbol,
                  " targetSl=", DoubleToString(targetSl, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS)),
                  " lock=", DoubleToString(g_basketLockedUsd[groupIndex], 2));
         }
      }
      if (!anyFailed) break;
   }

   g_basketLastTargetSl[groupIndex] = targetSl;
   g_basketLastProtectionTick[groupIndex] = TimeLocal();
   if (anyFailed)
   {
      g_basketLastModifyFailures[groupIndex]++;
      g_basketLastProtectionStatus[groupIndex] = "sl_modify_failed";
      Print("[BASKET_LOCK] emergency_close_after_sl_failure symbol=", symbol, " side=", g_basketSides[groupIndex]);
      CloseBasketGroup(symbol, positionType);
      return false;
   }

   g_basketLastModifyFailures[groupIndex] = 0;
   g_basketLastProtectionStatus[groupIndex] = anyNeeded ? "sl_modified" : "sl_confirmed";
   if (modified > 0)
   {
      Print("[BASKET_LOCK] basket_sl_confirmed symbol=", symbol,
            " side=", g_basketSides[groupIndex],
            " targetSl=", DoubleToString(targetSl, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS)),
            " modified=", modified,
            " lock=", DoubleToString(g_basketLockedUsd[groupIndex], 2));
   }
   return true;
}

string BuildBasketProtectionJson()
{
   string json = "[";
   bool first = true;
   for (int i = 0; i < g_basketGroupCount; i++)
   {
      if (g_basketLegCount[i] <= 0) continue;
      double drawdown = MathMax(0.0, g_basketPeakUsd[i] - g_basketFloatUsd[i]);
      bool closeArmed = g_basketLockedUsd[i] > 0.0 && g_basketFloatUsd[i] <= g_basketLockedUsd[i] + 0.05;
      if (!first) json += ",";
      first = false;
      json += StringFormat(
         "{\"symbol\":\"%s\",\"side\":\"%s\",\"legCount\":%d,\"floatingUsd\":%.2f,\"peakUsd\":%.2f,\"lockedUsd\":%.2f,\"drawdownFromPeakUsd\":%.2f,\"closeArmed\":%s,\"eaManaged\":true,\"targetStopLoss\":%.10f,\"slModificationStatus\":\"%s\",\"slModificationFailures\":%d,\"lastProtectionTick\":\"%s\"}",
         EscapeJson(g_basketSymbols[i]),
         EscapeJson(g_basketSides[i]),
         g_basketLegCount[i],
         g_basketFloatUsd[i],
         g_basketPeakUsd[i],
         g_basketLockedUsd[i],
         drawdown,
         closeArmed ? "true" : "false",
         g_basketLastTargetSl[i],
         EscapeJson(g_basketLastProtectionStatus[i]),
         g_basketLastModifyFailures[i],
         EscapeJson(g_basketLastProtectionTick[i] > 0 ? TimeToString(g_basketLastProtectionTick[i], TIME_DATE | TIME_SECONDS) : "")
      );
   }
   json += "]";
   return json;
}

void ManageBasketProfitLocks()
{
   if (!EnableBasketProfitLock) return;

   for (int resetIndex = 0; resetIndex < g_basketGroupCount; resetIndex++)
   {
      g_basketFloatUsd[resetIndex] = 0.0;
      g_basketLegCount[resetIndex] = 0;
   }

   bool activeGroups[MAX_BASKET_GROUPS];
   for (int i = 0; i < MAX_BASKET_GROUPS; i++) activeGroups[i] = false;

   for (int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if (!IsManagedBasketPosition(ticket)) continue;

      string symbol = PositionGetString(POSITION_SYMBOL);
      long positionType = PositionGetInteger(POSITION_TYPE);
      string side = positionType == POSITION_TYPE_BUY ? "buy" : "sell";
      string basketKey = symbol + "|" + side;
      int index = EnsureBasketGroupIndex(basketKey);
      if (index < 0) continue;

      activeGroups[index] = true;
      g_basketSymbols[index] = symbol;
      g_basketSides[index] = side;
      g_basketLegCount[index]++;
      g_basketFloatUsd[index] += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
   }

   bool stateChanged = false;
   datetime now = TimeLocal();

   for (int i = 0; i < g_basketGroupCount; i++)
   {
      if (!activeGroups[i])
      {
         if (g_basketLegCount[i] > 0 || g_basketPeakUsd[i] > 0.0 || g_basketLockedUsd[i] > 0.0)
         {
            ResetBasketGroupAt(i);
            stateChanged = true;
         }
         continue;
      }

      double previousPeak = g_basketPeakUsd[i];
      double previousLocked = g_basketLockedUsd[i];
      g_basketPeakUsd[i] = MathMax(g_basketPeakUsd[i], g_basketFloatUsd[i]);
      g_basketLockedUsd[i] = ResolveBasketLockedUsd(g_basketPeakUsd[i], g_basketLockedUsd[i]);

      if (g_basketLockedUsd[i] > previousLocked + 1e-6)
      {
         Print("[BASKET_LOCK] lock_raised symbol=", g_basketSymbols[i], " side=", g_basketSides[i],
               " float=", DoubleToString(g_basketFloatUsd[i], 2),
               " peak=", DoubleToString(g_basketPeakUsd[i], 2),
               " lock=", DoubleToString(g_basketLockedUsd[i], 2),
               " legs=", g_basketLegCount[i]);
         stateChanged = true;
      }
      else if (g_basketPeakUsd[i] > previousPeak + 1e-6)
      {
         Print("[BASKET_LOCK] peak_updated symbol=", g_basketSymbols[i], " side=", g_basketSides[i],
               " float=", DoubleToString(g_basketFloatUsd[i], 2),
               " peak=", DoubleToString(g_basketPeakUsd[i], 2),
               " lock=", DoubleToString(g_basketLockedUsd[i], 2));
         stateChanged = true;
      }

      if (g_basketLockedUsd[i] > 0.0)
      {
         if (!ApplyBasketProtectionStopLoss(i))
         {
            ResetBasketGroupAt(i);
            stateChanged = true;
            continue;
         }
      }

      if (g_basketLockedUsd[i] > 0.0 && g_basketFloatUsd[i] <= g_basketLockedUsd[i] + 0.05)
      {
         double drawdown = MathMax(0.0, g_basketPeakUsd[i] - g_basketFloatUsd[i]);
         Print("[BASKET_LOCK] reversal_close symbol=", g_basketSymbols[i], " side=", g_basketSides[i],
               " float=", DoubleToString(g_basketFloatUsd[i], 2),
               " peak=", DoubleToString(g_basketPeakUsd[i], 2),
               " lock=", DoubleToString(g_basketLockedUsd[i], 2),
               " drawdown=", DoubleToString(drawdown, 2),
               " legs=", g_basketLegCount[i]);
         long positionType = g_basketSides[i] == "buy" ? POSITION_TYPE_BUY : POSITION_TYPE_SELL;
         CloseBasketGroup(g_basketSymbols[i], positionType);
         ResetBasketGroupAt(i);
         stateChanged = true;
         continue;
      }
   }

   g_basketProtectionJson = BuildBasketProtectionJson();

   if (stateChanged || g_lastBasketLogAt == 0 || (now - g_lastBasketLogAt) >= BasketLockLogSeconds)
   {
      for (int i = 0; i < g_basketGroupCount; i++)
      {
         if (g_basketLegCount[i] <= 0) continue;
         double drawdown = MathMax(0.0, g_basketPeakUsd[i] - g_basketFloatUsd[i]);
         Print("[BASKET_LOCK] tick symbol=", g_basketSymbols[i],
               " float=", DoubleToString(g_basketFloatUsd[i], 2),
               " peak=", DoubleToString(g_basketPeakUsd[i], 2),
               " lock=", DoubleToString(g_basketLockedUsd[i], 2),
               " drawdown=", DoubleToString(drawdown, 2),
               " legs=", g_basketLegCount[i]);
      }
      g_lastBasketLogAt = now;
   }

   if (g_basketGroupCount > 0)
   {
      for (int i = 0; i < g_basketGroupCount; i++)
      {
         if (g_basketLegCount[i] <= 0) continue;
         Comment(StringFormat("Basket %s %s | float $%.2f | peak $%.2f | lock $%.2f | legs %d",
            g_basketSymbols[i], g_basketSides[i], g_basketFloatUsd[i], g_basketPeakUsd[i], g_basketLockedUsd[i], g_basketLegCount[i]));
         return;
      }
   }
   Comment("");
}

int OnInit()
{
   eaStartedAt = TimeLocal();
   EventSetTimer(1);
   Print("Cacsms Trader EA initialized for terminal: ", TerminalId);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("Cacsms Trader EA stopped. Reason: ", reason);
}

void OnTick()
{
   ProcessVirtualEntries();
   ManageBasketProfitLocks();
}

void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
{
   if (pendingOrderCount <= 0) return;
   if (trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   if (trans.order <= 0) return;
   int index = FindPendingIndex(trans.order);
   if (index < 0) return;
   string commandId = pendingOrderCommandIds[index];
   string terminalId = pendingOrderTerminalIds[index];
   string receivedType = pendingOrderTypes[index];
   RemovePendingAt(index);
   PostAck(commandId, terminalId, "filled", (string)trans.deal, "ok", trans.price, trans.volume, 0, 0, 0, receivedType);
}

void OnTimer()
{
   // Use local clock for timer cadence. TimeCurrent() freezes when the broker feed is idle.
   datetime now = TimeLocal();
   if (lastHeartbeat == 0 || (now - lastHeartbeat) >= HeartbeatSeconds)
   {
      SendHeartbeat();
   }
   if (CommandPollSeconds > 0 && (lastCommandPoll == 0 || (now - lastCommandPoll) >= CommandPollSeconds))
   {
      lastCommandPoll = now;
      PollNextCommand();
   }
   ProcessVirtualEntries();
}

const int FOCUS_SYMBOL_COUNT = 28;
const int TELEMETRY_STALE_SECONDS = 120;

string g_telemetrySymbols[28];
bool g_telemetryAvailable[28];
int g_telemetrySpreads[28];
int g_telemetryCount = 0;

string FocusSymbolKeys[28] =
{
   "EURUSD", "GBPUSD", "EURGBP", "EURJPY", "GBPJPY", "USDJPY", "USDCAD", "USDCHF",
   "AUDUSD", "NZDUSD", "AUDJPY", "EURAUD", "EURCAD", "EURCHF", "EURNZD", "GBPAUD",
   "GBPCAD", "AUDNZD", "CADJPY", "CHFJPY", "NZDJPY", "XAUUSD", "XAGUSD", "BTCUSD",
   "US30", "UK100", "NASDAQ100", "SP500"
};

string FocusSymbolAliases[28] =
{
   "EURUSD|EURUSDm",
   "GBPUSD|GBPUSDm",
   "EURGBP|EURGBPm",
   "EURJPY|EURJPYm",
   "GBPJPY|GBPJPYm",
   "USDJPY|USDJPYm",
   "USDCAD|USDCADm",
   "USDCHF|USDCHFm",
   "AUDUSD|AUDUSDm",
   "NZDUSD|NZDUSDm",
   "AUDJPY|AUDJPYm",
   "EURAUD|EURAUDm",
   "EURCAD|EURCADm",
   "EURCHF|EURCHFm",
   "EURNZD|EURNZDm",
   "GBPAUD|GBPAUDm",
   "GBPCAD|GBPCADm",
   "AUDNZD|AUDNZDm",
   "CADJPY|CADJPYm",
   "CHFJPY|CHFJPYm",
   "NZDJPY|NZDJPYm",
   "XAUUSD|XAUUSDm|GOLD",
   "XAGUSD|XAGUSDm|SILVER",
   "BTCUSD|BTCUSDm",
   "US30|DJ30|US30Cash",
   "UK100|FTSE100|UK100Cash",
   "NASDAQ100|NAS100|USTEC|US100",
   "SP500|SPX500|US500|SP500m"
};

string ClassifySymbolSector(string focusSymbol)
{
   if (StringFind(focusSymbol, "XAU") == 0 || StringFind(focusSymbol, "XAG") == 0) return "metals";
   if (StringFind(focusSymbol, "BTC") == 0) return "crypto";
   if (focusSymbol == "US30" || focusSymbol == "NASDAQ100" || focusSymbol == "SP500" || focusSymbol == "UK100") return "indices";
   return "forex";
}

bool ResolveFocusBrokerSymbol(string aliasCsv, string &brokerSymbolOut)
{
   string aliases[];
   int count = StringSplit(aliasCsv, '|', aliases);
   for (int i = 0; i < count; i++)
   {
      string candidate = aliases[i];
      StringTrimLeft(candidate);
      StringTrimRight(candidate);
      if (candidate == "") continue;
      if (SymbolSelect(candidate, true))
      {
         brokerSymbolOut = candidate;
         return true;
      }
   }
   brokerSymbolOut = "";
   return false;
}

bool ResolveCommandBrokerSymbol(string requestedSymbol, string &brokerSymbolOut)
{
   string normalized = requestedSymbol;
   StringToUpper(normalized);
   for (int i = 0; i < FOCUS_SYMBOL_COUNT; i++)
   {
      if (FocusSymbolKeys[i] == normalized)
      {
         return ResolveFocusBrokerSymbol(FocusSymbolAliases[i], brokerSymbolOut);
      }
   }
   if (SymbolSelect(requestedSymbol, true))
   {
      brokerSymbolOut = requestedSymbol;
      return true;
   }
   brokerSymbolOut = "";
   return false;
}

bool CollectFocusSymbolTelemetry(
   string focusSymbol,
   string aliasCsv,
   string &brokerSymbolOut,
   bool &availableOut,
   bool &tradableOut,
   bool &sessionOpenOut,
   double &bidOut,
   double &askOut,
   int &spreadPointsOut,
   int &digitsOut,
   double &pointOut,
   long &tickAgeSecondsOut,
   long &volumeOut,
   string &sectorOut,
   int &lastErrorOut
)
{
   brokerSymbolOut = "";
   availableOut = false;
   tradableOut = false;
   sessionOpenOut = false;
   bidOut = 0.0;
   askOut = 0.0;
   spreadPointsOut = 0;
   digitsOut = 0;
   pointOut = 0.0;
   tickAgeSecondsOut = -1;
   volumeOut = 0;
   sectorOut = ClassifySymbolSector(focusSymbol);
   lastErrorOut = 0;

   if (!ResolveFocusBrokerSymbol(aliasCsv, brokerSymbolOut))
   {
      lastErrorOut = ERR_MARKET_UNKNOWN_SYMBOL;
      return false;
   }

   availableOut = true;
   digitsOut = (int)SymbolInfoInteger(brokerSymbolOut, SYMBOL_DIGITS);
   pointOut = SymbolInfoDouble(brokerSymbolOut, SYMBOL_POINT);

   MqlTick tick;
   if (SymbolInfoTick(brokerSymbolOut, tick))
   {
      bidOut = tick.bid;
      askOut = tick.ask;
      tickAgeSecondsOut = (long)MathMax(0, TimeCurrent() - tick.time);
      volumeOut = (long)tick.volume;
   }
   else
   {
      SymbolInfoDouble(brokerSymbolOut, SYMBOL_BID, bidOut);
      SymbolInfoDouble(brokerSymbolOut, SYMBOL_ASK, askOut);
      tickAgeSecondsOut = -1;
      lastErrorOut = GetLastError();
   }

   if (pointOut > 0.0 && askOut >= bidOut)
      spreadPointsOut = (int)MathRound((askOut - bidOut) / pointOut);

   long tradeMode = SymbolInfoInteger(brokerSymbolOut, SYMBOL_TRADE_MODE);
   tradableOut = (tradeMode == SYMBOL_TRADE_MODE_FULL || tradeMode == SYMBOL_TRADE_MODE_LONGONLY || tradeMode == SYMBOL_TRADE_MODE_SHORTONLY);
   sessionOpenOut = (bidOut > 0.0 && askOut > 0.0 && spreadPointsOut > 0);
   return sessionOpenOut;
}

string BuildFocusSymbolTelemetryJson(int &availableCount, int &tradableCount, int &sessionOpenCount, int &staleCount, double &spreadSum)
{
   g_telemetryCount = 0;
   availableCount = 0;
   tradableCount = 0;
   sessionOpenCount = 0;
   staleCount = 0;
   spreadSum = 0.0;

   string json = "[";
   bool first = true;
   for (int i = 0; i < FOCUS_SYMBOL_COUNT; i++)
   {
      string brokerSymbol = "";
      bool available = false;
      bool tradable = false;
      bool sessionOpen = false;
      double bid = 0.0;
      double ask = 0.0;
      int spreadPoints = 0;
      int digits = 0;
      double point = 0.0;
      long tickAgeSeconds = -1;
      long volume = 0;
      string sector = "";
      int lastError = 0;

      CollectFocusSymbolTelemetry(
         FocusSymbolKeys[i],
         FocusSymbolAliases[i],
         brokerSymbol,
         available,
         tradable,
         sessionOpen,
         bid,
         ask,
         spreadPoints,
         digits,
         point,
         tickAgeSeconds,
         volume,
         sector,
         lastError
      );

      if (!first) json += ",";
      first = false;

      bool stale = (tickAgeSeconds < 0 || tickAgeSeconds > TELEMETRY_STALE_SECONDS);
      json += StringFormat(
         "{\"symbol\":\"%s\",\"brokerSymbol\":\"%s\",\"available\":%s,\"tradable\":%s,\"sessionOpen\":%s,\"bid\":%.10f,\"ask\":%.10f,\"spreadPoints\":%d,\"digits\":%d,\"point\":%.10f,\"tickAgeSeconds\":%I64d,\"volume\":%I64d,\"sector\":\"%s\",\"stale\":%s,\"lastError\":%d}",
         EscapeJson(FocusSymbolKeys[i]),
         EscapeJson(brokerSymbol),
         BoolToString(available),
         BoolToString(tradable),
         BoolToString(sessionOpen),
         bid,
         ask,
         spreadPoints,
         digits,
         point,
         tickAgeSeconds,
         volume,
         EscapeJson(sector),
         BoolToString(stale),
         lastError
      );

      if (g_telemetryCount < 16)
      {
         g_telemetrySymbols[g_telemetryCount] = FocusSymbolKeys[i];
         g_telemetryAvailable[g_telemetryCount] = available;
         g_telemetrySpreads[g_telemetryCount] = spreadPoints;
         g_telemetryCount++;
      }

      if (available) availableCount++;
      if (tradable) tradableCount++;
      if (sessionOpen) sessionOpenCount++;
      if (stale) staleCount++;
      if (available && spreadPoints > 0) spreadSum += spreadPoints;
   }
   json += "]";
   return json;
}

string BuildTelemetrySummaryJson(int availableCount, int tradableCount, int sessionOpenCount, int staleCount, double spreadSum, int availableSpreadCount)
{
   int avgSpread = availableSpreadCount > 0 ? (int)MathRound(spreadSum / availableSpreadCount) : 0;
   return StringFormat(
      "{\"tracked\":%d,\"available\":%d,\"tradable\":%d,\"sessionOpen\":%d,\"stale\":%d,\"avgSpreadPoints\":%d,\"version\":2}",
      FOCUS_SYMBOL_COUNT,
      availableCount,
      tradableCount,
      sessionOpenCount,
      staleCount,
      avgSpread
   );
}

int LookupTelemetrySpread(string symbol)
{
   for (int i = 0; i < g_telemetryCount; i++)
   {
      if (g_telemetrySymbols[i] == symbol) return g_telemetrySpreads[i];
   }
   return 0;
}

bool LookupTelemetryAvailable(string symbol)
{
   for (int i = 0; i < g_telemetryCount; i++)
   {
      if (g_telemetrySymbols[i] == symbol) return g_telemetryAvailable[i];
   }
   return false;
}

string BuildOpenPositionsJson()
{
   string json = "[";
   int total = PositionsTotal();
   bool first = true;
   for (int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if (ticket <= 0) continue;
      if (!PositionSelectByTicket(ticket)) continue;

      string symbol = PositionGetString(POSITION_SYMBOL);
      long positionType = PositionGetInteger(POSITION_TYPE);
      string side = positionType == POSITION_TYPE_BUY ? "buy" : "sell";
      double volumeLots = PositionGetDouble(POSITION_VOLUME);
      double entryPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double currentPrice = PositionGetDouble(POSITION_PRICE_CURRENT);
      double stopLoss = PositionGetDouble(POSITION_SL);
      double takeProfit = PositionGetDouble(POSITION_TP);
      double profitLoss = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);

      if (!first) json += ",";
      first = false;
      json += StringFormat(
         "{\"ticket\":\"%I64u\",\"symbol\":\"%s\",\"side\":\"%s\",\"volumeLots\":%.4f,\"entryPrice\":%.10f,\"currentPrice\":%.10f,\"stopLoss\":%.10f,\"takeProfit\":%.10f,\"profitLoss\":%.2f}",
         ticket,
         EscapeJson(symbol),
         side,
         volumeLots,
         entryPrice,
         currentPrice,
         stopLoss,
         takeProfit,
         profitLoss
      );
   }
   json += "]";
   return json;
}

void SendHeartbeat()
{
   lastHeartbeat = TimeLocal();
   heartbeatSequence++;

   string computerId = TerminalInfoString(TERMINAL_DATA_PATH);
   string computerName = TerminalInfoString(TERMINAL_NAME);
   string nigeriaTime = TimeToString((datetime)(TimeGMT() + 3600), TIME_DATE | TIME_SECONDS);
   string connectionStatus = "connected";
   long tradeMode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string accountType = tradeMode == 2 ? "live" : "demo";
   bool accountTradeAllowed = (AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) != 0);
   bool terminalTradeAllowed = (TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) != 0);

   int availableCount = 0;
   int tradableCount = 0;
   int sessionOpenCount = 0;
   int staleCount = 0;
   double spreadSum = 0.0;
   int availableSpreadCount = 0;
   string telemetryJson = BuildFocusSymbolTelemetryJson(availableCount, tradableCount, sessionOpenCount, staleCount, spreadSum);
   for (int i = 0; i < g_telemetryCount; i++)
   {
      if (g_telemetryAvailable[i] && g_telemetrySpreads[i] > 0)
      {
         availableSpreadCount++;
      }
   }
   string summaryJson = BuildTelemetrySummaryJson(availableCount, tradableCount, sessionOpenCount, staleCount, spreadSum, availableSpreadCount);

   bool eurusdAvailable = LookupTelemetryAvailable("EURUSD");
   bool xauusdAvailable = LookupTelemetryAvailable("XAUUSD");
   bool gbpusdAvailable = LookupTelemetryAvailable("GBPUSD");
   bool usdjpyAvailable = LookupTelemetryAvailable("USDJPY");
   int eurusdSpreadPoints = LookupTelemetrySpread("EURUSD");
   int xauusdSpreadPoints = LookupTelemetrySpread("XAUUSD");
   int gbpusdSpreadPoints = LookupTelemetrySpread("GBPUSD");
   int usdjpySpreadPoints = LookupTelemetrySpread("USDJPY");

   string enableExecutionJson = EnableExecution ? "true" : "false";
   string accountTradeAllowedJson = accountTradeAllowed ? "true" : "false";
   string terminalTradeAllowedJson = terminalTradeAllowed ? "true" : "false";
   string eurusdAvailableJson = eurusdAvailable ? "true" : "false";
   string xauusdAvailableJson = xauusdAvailable ? "true" : "false";
   string gbpusdAvailableJson = gbpusdAvailable ? "true" : "false";
   string usdjpyAvailableJson = usdjpyAvailable ? "true" : "false";

   string heartbeat = StringFormat(
      "{\"terminalId\":\"%s\",\"computerId\":\"%s\",\"computerName\":\"%s\",\"accountNumber\":\"%I64d\",\"brokerName\":\"%s\",\"serverName\":\"%s\",\"accountType\":\"%s\",\"enableExecution\":%s,\"accountTradeAllowed\":%s,\"terminalTradeAllowed\":%s,\"eurusdAvailable\":%s,\"xauusdAvailable\":%s,\"gbpusdAvailable\":%s,\"usdjpyAvailable\":%s,\"eurusdSpreadPoints\":%d,\"xauusdSpreadPoints\":%d,\"gbpusdSpreadPoints\":%d,\"usdjpySpreadPoints\":%d",
      EscapeJson(TerminalId),
      EscapeJson(computerId),
      EscapeJson(computerName),
      AccountInfoInteger(ACCOUNT_LOGIN),
      EscapeJson(AccountInfoString(ACCOUNT_COMPANY)),
      EscapeJson(AccountInfoString(ACCOUNT_SERVER)),
      EscapeJson(accountType),
      enableExecutionJson,
      accountTradeAllowedJson,
      terminalTradeAllowedJson,
      eurusdAvailableJson,
      xauusdAvailableJson,
      gbpusdAvailableJson,
      usdjpyAvailableJson,
      eurusdSpreadPoints,
      xauusdSpreadPoints,
      gbpusdSpreadPoints,
      usdjpySpreadPoints
   );
   heartbeat += ",\"symbolTelemetry\":" + telemetryJson;
   heartbeat += ",\"telemetrySummary\":" + summaryJson;
   heartbeat += ",\"openPositionSnapshots\":" + BuildOpenPositionsJson();
   heartbeat += ",\"basketProtection\":{\"enabled\":" + (EnableBasketProfitLock ? "true" : "false") + ",\"baskets\":" + g_basketProtectionJson + "}";
   heartbeat += StringFormat(
      ",\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,\"freeMargin\":%.2f,\"openPositions\":%d,\"openOrders\":%d,\"connectionStatus\":\"%s\",\"lastTickTime\":\"%s\",\"mt5ServerTime\":\"%s\",\"terminalTime\":\"%s\",\"nigeriaTime\":\"%s\",\"sentAt\":\"%s\",\"heartbeatIntervalSeconds\":%d,\"sequence\":%I64d,\"latencyMs\":%d,\"eaStartedAt\":\"%s\",\"version\":\"001.007\"}",
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      PositionsTotal(),
      OrdersTotal(),
      EscapeJson(connectionStatus),
      TimeToString(lastHeartbeat, TIME_DATE | TIME_SECONDS),
      TimeToString(lastHeartbeat, TIME_DATE | TIME_SECONDS),
      TimeToString(TimeLocal(), TIME_DATE | TIME_SECONDS),
      nigeriaTime,
      TimeToString(TimeLocal(), TIME_DATE | TIME_SECONDS),
      HeartbeatSeconds,
      heartbeatSequence,
      lastWebRequestLatencyMs,
      TimeToString(eaStartedAt, TIME_DATE | TIME_SECONDS)
   );

   string headers = "Content-Type: application/json\r\nX-Cacsms-Secret: " + BridgeSecret + "\r\n";
   char data[];
   char result[];
   string resultHeaders;

   StringToCharArray(heartbeat, data, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(data, ArraySize(data) - 1);

   ResetLastError();
   uint startedMs = GetTickCount();
   int statusCode = WebRequest(
      "POST",
      BridgeUrl + "/heartbeat",
      headers,
      WebRequestTimeoutMs,
      data,
      result,
      resultHeaders
   );
   lastWebRequestLatencyMs = (int)(GetTickCount() - startedMs);

   if(statusCode == 200)
   {
      Print("Cacsms heartbeat accepted by bridge. Sequence: ", heartbeatSequence, " Latency: ", lastWebRequestLatencyMs, "ms");
      return;
   }

   string responseBody = CharArrayToString(result, 0, -1, CP_UTF8);
   string bridgeError = ReadBridgeErrorBody(responseBody);
   Print("Cacsms heartbeat failed. Sequence: ", heartbeatSequence, " HTTP status: ", statusCode, " MT5 error: ", GetLastError(), " Latency: ", lastWebRequestLatencyMs, "ms", bridgeError != "" ? " Bridge: " + bridgeError : "");
   if (statusCode == 400 && StringFind(bridgeError, "invalid bridge secret") >= 0)
   {
      Print("Cacsms bridge secret mismatch. Open MT5 Infrastructure > Bridge Secret in the portal, copy the active secret, and paste it into this chart's EA BridgeSecret input.");
   }
}

void PollNextCommand()
{
   if (TerminalId == "UNCONFIGURED")
   {
      return;
   }

   string url = BridgeUrl + "/commands/next?terminalId=" + UrlEncode(TerminalId);
   string headers = "Content-Type: application/json\r\nX-Cacsms-Secret: " + BridgeSecret + "\r\n";
   char data[];
   char result[];
   string resultHeaders;

   ResetLastError();
   uint startedMs = GetTickCount();
   int statusCode = WebRequest(
      "GET",
      url,
      headers,
      WebRequestTimeoutMs,
      data,
      result,
      resultHeaders
   );
   int latencyMs = (int)(GetTickCount() - startedMs);

   if (statusCode != 200)
   {
      string responseBody = CharArrayToString(result, 0, -1, CP_UTF8);
      string bridgeError = ReadBridgeErrorBody(responseBody);
      Print("Cacsms command poll failed. HTTP status: ", statusCode, " MT5 error: ", GetLastError(), " Latency: ", latencyMs, "ms", bridgeError != "" ? " Bridge: " + bridgeError : "");
      if (statusCode == 400 && StringFind(bridgeError, "invalid bridge secret") >= 0)
      {
         Print("Cacsms bridge secret mismatch. Update the EA BridgeSecret input on this chart to match the portal bridge secret.");
      }
      return;
   }

   string body = CharArrayToString(result, 0, -1, CP_UTF8);
   Print("EA_RAW_COMMAND_PAYLOAD ", TruncateString(body, 900));
   string commandJson;
   bool isNull = false;
   if (!ExtractJsonObject(body, "command", commandJson, isNull))
   {
      return;
   }
   if (isNull || commandJson == "")
   {
      return;
   }

   string commandId;
   string commandType = "";
   string terminalId;
   string payloadJson;
   if (!ExtractJsonString(commandJson, "commandId", commandId)) return;
   ExtractJsonString(commandJson, "type", commandType);
   if (!ExtractJsonString(commandJson, "terminalId", terminalId)) terminalId = TerminalId;
   bool payloadNull = false;
   if (!ExtractJsonObject(commandJson, "payload", payloadJson, payloadNull)) payloadJson = "{}";

   string parsedSymbol = "";
   string parsedSide = "";
   string parsedOrderType = "";
   double parsedVolume = 0.0;
   ExtractJsonString(payloadJson, "symbol", parsedSymbol);
   ExtractJsonString(payloadJson, "side", parsedSide);
   if (!ExtractJsonString(payloadJson, "orderType", parsedOrderType))
   {
      ExtractJsonString(payloadJson, "orderKind", parsedOrderType);
   }
   if (!ExtractJsonNumber(payloadJson, "volume", parsedVolume))
   {
      ExtractJsonNumber(payloadJson, "volumeLots", parsedVolume);
   }

   Print("EA_PARSED_TYPE ", commandType);
   Print("EA_PARSED_SYMBOL ", parsedSymbol);
   Print("EA_PARSED_SIDE ", parsedSide);
   Print("EA_PARSED_ORDER_TYPE ", parsedOrderType);
   Print("EA_PARSED_VOLUME ", DoubleToString(parsedVolume, 4));
   Print("EA_ENABLE_EXECUTION ", BoolToString(EnableExecution));
   bool accountTradeAllowed = (AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) != 0);
   bool terminalTradeAllowed = (TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) != 0);
   Print("EA_ACCOUNT_TRADE_ALLOWED ", BoolToString(accountTradeAllowed));
   Print("EA_TERMINAL_TRADE_ALLOWED ", BoolToString(terminalTradeAllowed));

   string ackStatus = "failed";
   string ticket = "";
   string brokerMessage = "";
   double executedPrice = 0.0;
   double executedVolumeLots = 0.0;
   int slippagePoints = 0;
   int spreadPoints = 0;

   string typeUpper = StringTrim(commandType);
   StringToUpper(typeUpper);
   if (typeUpper == "")
   {
      ackStatus = "failed";
      brokerMessage = "{\"status\":\"FAILED\",\"reason\":\"missing_type\",\"receivedType\":\"\"}";
   }
   else if (!EnableExecution && !IsChartControlCommand(typeUpper))
   {
      ackStatus = "rejected";
      brokerMessage = "execution_disabled";
   }
   else
   {
      currentCommandId = commandId;
      currentCommandTerminalId = terminalId;
      ExecuteCommand(commandType, payloadJson, ackStatus, ticket, brokerMessage, executedPrice, executedVolumeLots, slippagePoints, spreadPoints);
      currentCommandId = "";
      currentCommandTerminalId = "";
   }

   PostAck(commandId, terminalId, ackStatus, ticket, brokerMessage, executedPrice, executedVolumeLots, slippagePoints, spreadPoints, latencyMs, commandType);
}

bool IsChartControlCommand(string commandType)
{
   return commandType == "OPEN_CHART"
      || commandType == "SET_TIMEFRAME"
      || commandType == "CAPTURE_CHART"
      || commandType == "CLOSE_CHART";
}

void ExecuteCommand(string commandType, string payloadJson, string &ackStatus, string &ticket, string &brokerMessage, double &executedPrice, double &executedVolumeLots, int &slippagePointsOut, int &spreadPointsOut)
{
   string normalized = commandType;
   StringToLower(normalized);
   normalized = StringTrim(normalized);
   StringReplace(normalized, "-", "_");
   if (normalized == "test_hardcoded_order")
   {
      string hardcodedPayload = "{\"type\":\"TEST_HARDCODED_ORDER\",\"symbol\":\"EURUSD\",\"side\":\"BUY\",\"orderType\":\"MARKET\",\"volume\":0.01,\"mode\":\"SANDBOX\",\"environment\":\"DEMO\",\"comment\":\"Cacsms Trader hardcoded test\"}";
      ExecutePlaceOrder(hardcodedPayload, ackStatus, ticket, brokerMessage, executedPrice, executedVolumeLots, slippagePointsOut, spreadPointsOut);
      return;
   }
   if (normalized == "place_order")
   {
      ExecutePlaceOrder(payloadJson, ackStatus, ticket, brokerMessage, executedPrice, executedVolumeLots, slippagePointsOut, spreadPointsOut);
      return;
   }
   if (normalized == "open_chart")
   {
      ExecuteOpenChart(payloadJson, ackStatus, brokerMessage);
      return;
   }
   if (normalized == "set_timeframe")
   {
      ExecuteSetTimeframe(payloadJson, ackStatus, brokerMessage);
      return;
   }
   if (normalized == "capture_chart")
   {
      ExecuteCaptureChart(payloadJson, ackStatus, brokerMessage);
      return;
   }
   if (normalized == "close_chart")
   {
      ExecuteCloseChart(payloadJson, ackStatus, brokerMessage);
      return;
   }
   if (normalized == "modify_order")
   {
      ExecuteModifyOrder(payloadJson, ackStatus, ticket, brokerMessage);
      return;
   }
   if (normalized == "close_order")
   {
      ExecuteCloseOrder(payloadJson, ackStatus, ticket, brokerMessage);
      return;
   }
   if (normalized == "partial_close")
   {
      ExecutePartialClose(payloadJson, ackStatus, ticket, brokerMessage);
      return;
   }
   if (normalized == "move_to_breakeven")
   {
      ExecuteMoveToBreakeven(payloadJson, ackStatus, ticket, brokerMessage);
      return;
   }
   if (normalized == "set_trailing_stop")
   {
      ExecuteSetTrailingStop(payloadJson, ackStatus, ticket, brokerMessage);
      return;
   }
   if (normalized == "emergency_close_all")
   {
      ExecuteEmergencyCloseAll(ackStatus, brokerMessage);
      return;
   }
   ackStatus = "failed";
   brokerMessage = StringFormat("{\"status\":\"FAILED\",\"reason\":\"unsupported_command_type\",\"receivedType\":\"%s\"}", EscapeJson(commandType));
}

void ExecuteOpenChart(string payloadJson, string &ackStatus, string &brokerMessage)
{
   string symbol;
   string brokerSymbol;
   if (!ExtractJsonString(payloadJson, "symbol", symbol))
   {
      ackStatus = "failed";
      brokerMessage = "missing_symbol";
      return;
   }
   if (!ResolveCommandBrokerSymbol(symbol, brokerSymbol))
   {
      ackStatus = "failed";
      brokerMessage = "symbol_not_available";
      return;
   }
   long chartId = ChartOpen(brokerSymbol, PERIOD_H1);
   if (chartId <= 0)
   {
      ackStatus = "failed";
      brokerMessage = "chart_open_failed";
      return;
   }
   ackStatus = "accepted";
   brokerMessage = StringFormat("{\"status\":\"OK\",\"chartId\":%I64d,\"symbol\":\"%s\",\"brokerSymbol\":\"%s\"}", chartId, EscapeJson(symbol), EscapeJson(brokerSymbol));
}

void ExecuteSetTimeframe(string payloadJson, string &ackStatus, string &brokerMessage)
{
   string symbol;
   string brokerSymbol;
   string timeframe;
   if (!ExtractJsonString(payloadJson, "symbol", symbol))
   {
      ackStatus = "failed";
      brokerMessage = "missing_symbol";
      return;
   }
   if (!ExtractJsonString(payloadJson, "timeframe", timeframe))
   {
      if (!ExtractJsonString(payloadJson, "period", timeframe))
      {
         ackStatus = "failed";
         brokerMessage = "missing_timeframe";
         return;
      }
   }
   if (!ResolveCommandBrokerSymbol(symbol, brokerSymbol))
   {
      ackStatus = "failed";
      brokerMessage = "symbol_not_available";
      return;
   }
   ENUM_TIMEFRAMES period = ParseTimeframePeriod(timeframe);
   long chartId = ChartOpen(brokerSymbol, period);
   if (chartId <= 0)
   {
      ackStatus = "failed";
      brokerMessage = "chart_timeframe_failed";
      return;
   }
   ChartSetSymbolPeriod(chartId, brokerSymbol, period);
   ChartRedraw(chartId);
   ackStatus = "accepted";
   brokerMessage = StringFormat("{\"status\":\"OK\",\"chartId\":%I64d,\"symbol\":\"%s\",\"brokerSymbol\":\"%s\",\"timeframe\":\"%s\"}", chartId, EscapeJson(symbol), EscapeJson(brokerSymbol), EscapeJson(timeframe));
}

void ExecuteCaptureChart(string payloadJson, string &ackStatus, string &brokerMessage)
{
   string symbol;
   string brokerSymbol;
   string timeframe;
   double barCount = 120.0;
   if (!ExtractJsonString(payloadJson, "symbol", symbol))
   {
      ackStatus = "failed";
      brokerMessage = "missing_symbol";
      return;
   }
   if (!ExtractJsonString(payloadJson, "timeframe", timeframe))
   {
      if (!ExtractJsonString(payloadJson, "period", timeframe)) timeframe = "PERIOD_H1";
   }
   ExtractJsonNumber(payloadJson, "barCount", barCount);
   if (!ResolveCommandBrokerSymbol(symbol, brokerSymbol))
   {
      ackStatus = "failed";
      brokerMessage = "symbol_not_available";
      return;
   }
   ENUM_TIMEFRAMES period = ParseTimeframePeriod(timeframe);
   int bars = (int)MathMax(20, MathMin(500, barCount));
   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   int copied = CopyRates(brokerSymbol, period, 0, bars, rates);
   if (copied <= 0)
   {
      ackStatus = "failed";
      brokerMessage = "copy_rates_failed";
      return;
   }
   string barsJson = "[";
   for (int i = copied - 1; i >= 0; i--)
   {
      if (i != copied - 1) barsJson += ",";
      barsJson += StringFormat(
         "{\"time\":\"%s\",\"open\":%s,\"high\":%s,\"low\":%s,\"close\":%s,\"volume\":%s}",
         TimeToString(rates[i].time, TIME_DATE | TIME_SECONDS),
         DoubleToJson(rates[i].open),
         DoubleToJson(rates[i].high),
         DoubleToJson(rates[i].low),
         DoubleToJson(rates[i].close),
         DoubleToJson((double)rates[i].tick_volume)
      );
   }
   barsJson += "]";
   ackStatus = "accepted";
   brokerMessage = StringFormat("{\"status\":\"OK\",\"symbol\":\"%s\",\"brokerSymbol\":\"%s\",\"timeframe\":\"%s\",\"bars\":%s}", EscapeJson(symbol), EscapeJson(brokerSymbol), EscapeJson(timeframe), barsJson);
}

void ExecuteCloseChart(string payloadJson, string &ackStatus, string &brokerMessage)
{
   string symbol;
   if (!ExtractJsonString(payloadJson, "symbol", symbol))
   {
      ackStatus = "accepted";
      brokerMessage = "{\"status\":\"OK\",\"detail\":\"no_symbol_provided\"}";
      return;
   }
   long chartId = ChartFirst();
   bool closedAny = false;
   while (chartId >= 0)
   {
      long nextChartId = ChartNext(chartId);
      if (ChartSymbol(chartId) == symbol)
      {
         ChartClose(chartId);
         closedAny = true;
      }
      chartId = nextChartId;
   }
   ackStatus = "accepted";
   brokerMessage = closedAny ? "{\"status\":\"OK\",\"detail\":\"chart_closed\"}" : "{\"status\":\"OK\",\"detail\":\"chart_not_found\"}";
}

ENUM_TIMEFRAMES ParseTimeframePeriod(string timeframe)
{
   string normalized = timeframe;
   StringToUpper(normalized);
   StringTrimLeft(normalized);
   StringTrimRight(normalized);
   if (normalized == "W" || normalized == "PERIOD_W1") return PERIOD_W1;
   if (normalized == "D" || normalized == "PERIOD_D1") return PERIOD_D1;
   if (normalized == "H4" || normalized == "PERIOD_H4") return PERIOD_H4;
   if (normalized == "H1" || normalized == "PERIOD_H1") return PERIOD_H1;
   if (normalized == "M15" || normalized == "PERIOD_M15") return PERIOD_M15;
   if (normalized == "M5" || normalized == "PERIOD_M5") return PERIOD_M5;
   if (normalized == "M1" || normalized == "PERIOD_M1") return PERIOD_M1;
   if (normalized == "M30" || normalized == "PERIOD_M30") return PERIOD_M30;
   if (normalized == "MN" || normalized == "MN1" || normalized == "PERIOD_MN1") return PERIOD_MN1;
   return PERIOD_H1;
}

bool HasContinuationConfirmation(string symbol, ENUM_TIMEFRAMES timeframe, string sideLower)
{
   double open1 = iOpen(symbol, timeframe, 1);
   double close1 = iClose(symbol, timeframe, 1);
   double high1 = iHigh(symbol, timeframe, 1);
   double low1 = iLow(symbol, timeframe, 1);
   double open2 = iOpen(symbol, timeframe, 2);
   double close2 = iClose(symbol, timeframe, 2);
   double high2 = iHigh(symbol, timeframe, 2);
   double low2 = iLow(symbol, timeframe, 2);
   if (open1 <= 0.0 || close1 <= 0.0 || high1 <= 0.0 || low1 <= 0.0) return false;
   double pointRef = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if (pointRef <= 0.0) pointRef = 0.00001;
   double body = MathAbs(close1 - open1);
   double range = MathMax(high1 - low1, pointRef);
   double upperWick = high1 - MathMax(open1, close1);
   double lowerWick = MathMin(open1, close1) - low1;
   bool bullish = close1 > open1;
   bool bearish = close1 < open1;
   bool bullishEngulf = bullish && open2 > 0.0 && close2 > 0.0 && close2 < open2 && close1 >= open2 && open1 <= close2;
   bool bearishEngulf = bearish && open2 > 0.0 && close2 > 0.0 && close2 > open2 && close1 <= open2 && open1 >= close2;
   bool bullishPin = bullish && lowerWick >= body * 1.2 && lowerWick >= range * 0.35;
   bool bearishPin = bearish && upperWick >= body * 1.2 && upperWick >= range * 0.35;
   bool bullishMomentum = bullish && high2 > 0.0 && close1 > high2;
   bool bearishMomentum = bearish && low2 > 0.0 && close1 < low2;
   if (sideLower == "buy") return bullishEngulf || bullishPin || bullishMomentum;
   if (sideLower == "sell") return bearishEngulf || bearishPin || bearishMomentum;
   return false;
}

void ProcessVirtualEntries()
{
   if (virtualEntryCount <= 0) return;
   for (int index = virtualEntryCount - 1; index >= 0; index--)
   {
      if (!virtualEntryActive[index]) continue;
      string symbol = virtualEntrySymbols[index];
      string sideLower = virtualEntrySides[index];
      StringToLower(sideLower);
      double bid = 0.0;
      double ask = 0.0;
      if (!SymbolSelect(symbol, true) || !SymbolInfoDouble(symbol, SYMBOL_BID, bid) || !SymbolInfoDouble(symbol, SYMBOL_ASK, ask))
      {
         continue;
      }
      double entry = virtualEntryPrices[index];
      double cancelPrice = virtualEntryCancelPrices[index];
      bool cancelled = (sideLower == "buy" && cancelPrice > 0.0 && bid <= cancelPrice)
         || (sideLower == "sell" && cancelPrice > 0.0 && ask >= cancelPrice);
      if (cancelled)
      {
         PostAck(virtualEntryCommandIds[index], virtualEntryTerminalIds[index], "failed", "", "conditional_entry_cancelled_max_retracement", 0.0, 0.0, 0, 0, 0, "PLACE_ORDER");
         RemoveVirtualEntryAt(index);
         continue;
      }
      bool priceReached = (sideLower == "buy" && ask <= entry) || (sideLower == "sell" && bid >= entry);
      if (!priceReached) continue;
      if (!HasContinuationConfirmation(symbol, virtualEntryTimeframes[index], sideLower)) continue;

      trade.SetDeviationInPoints(SlippagePoints);
      trade.SetExpertMagicNumber((ulong)MagicNumber);
      bool ok = false;
      double requestPrice = sideLower == "buy" ? ask : bid;
      if (sideLower == "buy")
      {
         ok = trade.Buy(virtualEntryVolumes[index], symbol, 0.0, virtualEntryStopLosses[index], virtualEntryTakeProfits[index], virtualEntryComments[index]);
      }
      else if (sideLower == "sell")
      {
         ok = trade.Sell(virtualEntryVolumes[index], symbol, 0.0, virtualEntryStopLosses[index], virtualEntryTakeProfits[index], virtualEntryComments[index]);
      }
      if (!ok)
      {
         PostAck(virtualEntryCommandIds[index], virtualEntryTerminalIds[index], "failed", "", trade.ResultRetcodeDescription(), 0.0, 0.0, 0, 0, 0, "PLACE_ORDER");
         RemoveVirtualEntryAt(index);
         continue;
      }
      ulong deal = trade.ResultDeal();
      ulong order = trade.ResultOrder();
      double executedPrice = trade.ResultPrice();
      if (executedPrice <= 0.0) executedPrice = requestPrice;
      double pointRef = SymbolInfoDouble(symbol, SYMBOL_POINT);
      int slippage = pointRef > 0.0 ? (int)MathRound(MathAbs(executedPrice - requestPrice) / pointRef) : 0;
      string ticket = (string)(deal > 0 ? deal : order);
      PostAck(virtualEntryCommandIds[index], virtualEntryTerminalIds[index], "filled", ticket, "conditional_entry_confirmed", executedPrice, virtualEntryVolumes[index], slippage, 0, 0, "PLACE_ORDER");
      RemoveVirtualEntryAt(index);
   }
}

void ExecutePlaceOrder(string payloadJson, string &ackStatus, string &ticket, string &brokerMessage, double &executedPrice, double &executedVolumeLots, int &slippagePointsOut, int &spreadPointsOut)
{
   string symbol;
   string side;
   string orderKind;
   double volumeLots = 0.0;
   double stopLoss = 0.0;
   double takeProfit = 0.0;
   double requestedEntryPrice = 0.0;
   double cancelIfPriceBeyond = 0.0;
   string comment = "cacsms";
   string timeframeText = "M15";

   if (!ExtractJsonString(payloadJson, "symbol", symbol)) { ackStatus = "failed"; brokerMessage = "{\"status\":\"FAILED\",\"reason\":\"missing_symbol\"}"; return; }
   if (!ExtractJsonString(payloadJson, "side", side)) { ackStatus = "failed"; brokerMessage = "{\"status\":\"FAILED\",\"reason\":\"missing_side\"}"; return; }
   if (!ExtractJsonString(payloadJson, "orderKind", orderKind))
   {
      if (!ExtractJsonString(payloadJson, "orderType", orderKind)) orderKind = "market";
   }
   if (!ExtractJsonNumber(payloadJson, "volume", volumeLots))
   {
      if (!ExtractJsonNumber(payloadJson, "volumeLots", volumeLots)) { ackStatus = "failed"; brokerMessage = "{\"status\":\"FAILED\",\"reason\":\"missing_volume\"}"; return; }
   }
   if (!ExtractJsonNumber(payloadJson, "stopLoss", stopLoss))
   {
      if (!ExtractJsonNumber(payloadJson, "sl", stopLoss)) stopLoss = 0.0;
   }
   if (!ExtractJsonNumber(payloadJson, "takeProfit", takeProfit))
   {
      if (!ExtractJsonNumber(payloadJson, "tp", takeProfit)) takeProfit = 0.0;
   }
   if (!ExtractJsonNumber(payloadJson, "entryPrice", requestedEntryPrice))
   {
      if (!ExtractJsonNumber(payloadJson, "price", requestedEntryPrice))
      {
         if (!ExtractJsonNumber(payloadJson, "pendingEntryPrice", requestedEntryPrice)) requestedEntryPrice = 0.0;
      }
   }
   ExtractJsonString(payloadJson, "comment", comment);
   ExtractJsonString(payloadJson, "timeframe", timeframeText);
   ExtractJsonNumber(payloadJson, "cancelIfPriceBeyond", cancelIfPriceBeyond);

   if (!SymbolSelect(symbol, true))
   {
      ackStatus = "failed";
      brokerMessage = "symbol_not_available";
      return;
   }

   if (!AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
   {
      ackStatus = "failed";
      brokerMessage = "trade_not_allowed";
      return;
   }

   double volMin = 0.0, volMax = 0.0, volStep = 0.0;
   if (!SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN, volMin)) volMin = 0.01;
   if (!SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX, volMax)) volMax = volumeLots;
   if (!SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP, volStep)) volStep = 0.01;
   double normalizedLots = NormalizeVolume(volumeLots, volMin, volMax, volStep);
   if (normalizedLots <= 0.0)
   {
      ackStatus = "failed";
      brokerMessage = "invalid_volume";
      return;
   }

   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   stopLoss = NormalizeDouble(stopLoss, digits);
   takeProfit = NormalizeDouble(takeProfit, digits);

   trade.SetDeviationInPoints(SlippagePoints);
   trade.SetExpertMagicNumber((ulong)MagicNumber);

   bool ok = false;
   double requestPrice = 0.0;
   double pointRef = SymbolInfoDouble(symbol, SYMBOL_POINT);
   datetime expiration = TimeCurrent() + 60 * 60 * 4;
   string orderKindLower = orderKind;
   StringToLower(orderKindLower);
   bool requiresConfirmation = StringFind(payloadJson, "\"requiresContinuationConfirmation\":true") >= 0
      || StringFind(payloadJson, "\"requiresContinuationConfirmation\": true") >= 0;
   string sideLower = side;
   StringToLower(sideLower);
   if (sideLower == "buy")
   {
      double bid = 0.0;
      double ask = 0.0;
      SymbolInfoDouble(symbol, SYMBOL_BID, bid);
      SymbolInfoDouble(symbol, SYMBOL_ASK, ask);
      spreadPointsOut = pointRef > 0.0 ? (int)MathRound((ask - bid) / pointRef) : 0;
      if (orderKindLower == "buy_limit" || orderKindLower == "limit" || orderKindLower == "pending_limit")
      {
         requestPrice = NormalizeDouble(requestedEntryPrice, digits);
         if (requestPrice <= 0.0 || requestPrice >= ask)
         {
            ackStatus = "failed";
            brokerMessage = "invalid_buy_limit_price";
            return;
         }
         if (requiresConfirmation)
         {
            if (!AddVirtualEntry(currentCommandId, currentCommandTerminalId, symbol, sideLower, ParseTimeframePeriod(timeframeText), normalizedLots, requestPrice, stopLoss, takeProfit, cancelIfPriceBeyond, comment))
            {
               ackStatus = "failed";
               brokerMessage = "conditional_entry_queue_full";
               return;
            }
            ackStatus = "accepted";
            ticket = currentCommandId;
            brokerMessage = "conditional_entry_waiting_for_retracement_confirmation";
            executedPrice = requestPrice;
            executedVolumeLots = normalizedLots;
            return;
         }
         ok = trade.BuyLimit(normalizedLots, requestPrice, symbol, stopLoss, takeProfit, ORDER_TIME_SPECIFIED, expiration, comment);
      }
      else
      {
         requestPrice = ask;
         ok = trade.Buy(normalizedLots, symbol, 0.0, stopLoss, takeProfit, comment);
      }
   }
   else if (sideLower == "sell")
   {
      double bid = 0.0;
      double ask = 0.0;
      SymbolInfoDouble(symbol, SYMBOL_BID, bid);
      SymbolInfoDouble(symbol, SYMBOL_ASK, ask);
      spreadPointsOut = pointRef > 0.0 ? (int)MathRound((ask - bid) / pointRef) : 0;
      if (orderKindLower == "sell_limit" || orderKindLower == "limit" || orderKindLower == "pending_limit")
      {
         requestPrice = NormalizeDouble(requestedEntryPrice, digits);
         if (requestPrice <= 0.0 || requestPrice <= bid)
         {
            ackStatus = "failed";
            brokerMessage = "invalid_sell_limit_price";
            return;
         }
         if (requiresConfirmation)
         {
            if (!AddVirtualEntry(currentCommandId, currentCommandTerminalId, symbol, sideLower, ParseTimeframePeriod(timeframeText), normalizedLots, requestPrice, stopLoss, takeProfit, cancelIfPriceBeyond, comment))
            {
               ackStatus = "failed";
               brokerMessage = "conditional_entry_queue_full";
               return;
            }
            ackStatus = "accepted";
            ticket = currentCommandId;
            brokerMessage = "conditional_entry_waiting_for_retracement_confirmation";
            executedPrice = requestPrice;
            executedVolumeLots = normalizedLots;
            return;
         }
         ok = trade.SellLimit(normalizedLots, requestPrice, symbol, stopLoss, takeProfit, ORDER_TIME_SPECIFIED, expiration, comment);
      }
      else
      {
         requestPrice = bid;
         ok = trade.Sell(normalizedLots, symbol, 0.0, stopLoss, takeProfit, comment);
      }
   }
   else
   {
      ackStatus = "failed";
      brokerMessage = "invalid_side";
      return;
   }

   if (!ok)
   {
      ackStatus = "failed";
      brokerMessage = trade.ResultRetcodeDescription();
      return;
   }

   ulong deal = trade.ResultDeal();
   ulong order = trade.ResultOrder();
   executedPrice = trade.ResultPrice();
   if (executedPrice <= 0.0) executedPrice = requestPrice;
   slippagePointsOut = pointRef > 0.0 ? (int)MathRound(MathAbs(executedPrice - requestPrice) / pointRef) : 0;
   executedVolumeLots = normalizedLots;
   ulong positionTicket = ResolveLatestPositionTicket(symbol);
   if (positionTicket > 0)
   {
      ticket = (string)positionTicket;
   }
   else
   {
      ticket = (string)(deal > 0 ? deal : order);
   }
   if (deal > 0)
   {
      ackStatus = "filled";
      brokerMessage = "ok";
   }
   else
   {
      ackStatus = "accepted";
      brokerMessage = "order_accepted";
      AddPending(order, currentCommandId, currentCommandTerminalId);
   }
}

void ExecuteCloseOrder(string payloadJson, string &ackStatus, string &ticket, string &brokerMessage)
{
   string ticketValue;
   string symbol;
   double volumeLots = 0.0;
   if (!ExtractJsonString(payloadJson, "ticket", ticketValue))
   {
      ackStatus = "failed";
      brokerMessage = "missing_ticket";
      return;
   }
   ExtractJsonString(payloadJson, "symbol", symbol);
   ExtractJsonNumber(payloadJson, "volumeLots", volumeLots);

   ulong positionTicket = ResolvePositionTicket(ticketValue, symbol);
   trade.SetDeviationInPoints(SlippagePoints);
   trade.SetExpertMagicNumber((ulong)MagicNumber);

   bool ok = false;
   if (positionTicket > 0 && PositionSelectByTicket(positionTicket))
   {
      string symbol = PositionGetString(POSITION_SYMBOL);
      if (volumeLots > 0.0)
      {
         ok = trade.PositionClosePartial(symbol, volumeLots);
      }
      else
      {
         ok = trade.PositionClose(symbol);
      }
   }

   if (!ok)
   {
      ackStatus = "failed";
      brokerMessage = trade.ResultRetcodeDescription();
      ticket = ticketValue;
      return;
   }

   ackStatus = "accepted";
   brokerMessage = "ok";
   ticket = ticketValue;
}

void ExecuteModifyOrder(string payloadJson, string &ackStatus, string &ticket, string &brokerMessage)
{
   string ticketValue;
   string symbol;
   double stopLoss = 0.0;
   double takeProfit = 0.0;

   if (!ExtractJsonString(payloadJson, "ticket", ticketValue))
   {
      ackStatus = "failed";
      brokerMessage = "missing_ticket";
      return;
   }
   ExtractJsonString(payloadJson, "symbol", symbol);
   if (!ExtractJsonNumber(payloadJson, "stopLoss", stopLoss))
   {
      if (!ExtractJsonNumber(payloadJson, "sl", stopLoss)) stopLoss = 0.0;
   }
   if (!ExtractJsonNumber(payloadJson, "takeProfit", takeProfit))
   {
      if (!ExtractJsonNumber(payloadJson, "tp", takeProfit)) takeProfit = 0.0;
   }

   ulong positionTicket = ResolvePositionTicket(ticketValue, symbol);
   trade.SetDeviationInPoints(SlippagePoints);
   trade.SetExpertMagicNumber((ulong)MagicNumber);

   bool ok = false;
   if (positionTicket > 0 && PositionSelectByTicket(positionTicket))
   {
      string symbol = PositionGetString(POSITION_SYMBOL);
      int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
      double sl = stopLoss > 0.0 ? NormalizeDouble(stopLoss, digits) : PositionGetDouble(POSITION_SL);
      double tp = takeProfit > 0.0 ? NormalizeDouble(takeProfit, digits) : PositionGetDouble(POSITION_TP);
      ok = trade.PositionModify(symbol, sl, tp);
   }

   if (!ok)
   {
      ackStatus = "failed";
      brokerMessage = trade.ResultRetcodeDescription();
      ticket = ticketValue;
      return;
   }

   ackStatus = "accepted";
   brokerMessage = "ok";
   ticket = ticketValue;
}

void ExecutePartialClose(string payloadJson, string &ackStatus, string &ticket, string &brokerMessage)
{
   string ticketValue;
   double volumeLots = 0.0;
   string symbol;
   if (!ExtractJsonString(payloadJson, "ticket", ticketValue))
   {
      ackStatus = "failed";
      brokerMessage = "missing_ticket";
      return;
   }
   ExtractJsonString(payloadJson, "symbol", symbol);
   if (!ExtractJsonNumber(payloadJson, "volumeLots", volumeLots))
   {
      if (!ExtractJsonNumber(payloadJson, "volume", volumeLots))
      {
         ackStatus = "failed";
         brokerMessage = "missing_volume";
         return;
      }
   }

   ulong positionTicket = ResolvePositionTicket(ticketValue, symbol);
   trade.SetDeviationInPoints(SlippagePoints);
   trade.SetExpertMagicNumber((ulong)MagicNumber);

   if (positionTicket <= 0 || !PositionSelectByTicket(positionTicket))
   {
      ackStatus = "failed";
      brokerMessage = "position_not_found";
      ticket = ticketValue;
      return;
   }

   string positionSymbol = PositionGetString(POSITION_SYMBOL);
   double volMin = 0.0, volMax = 0.0, volStep = 0.0;
   SymbolInfoDouble(positionSymbol, SYMBOL_VOLUME_MIN, volMin);
   SymbolInfoDouble(positionSymbol, SYMBOL_VOLUME_MAX, volMax);
   SymbolInfoDouble(positionSymbol, SYMBOL_VOLUME_STEP, volStep);
   double normalizedLots = NormalizeVolume(volumeLots, volMin, volMax, volStep);
   if (!trade.PositionClosePartial(positionSymbol, normalizedLots))
   {
      ackStatus = "failed";
      brokerMessage = trade.ResultRetcodeDescription();
      ticket = ticketValue;
      return;
   }

   ackStatus = "accepted";
   brokerMessage = "ok";
   ticket = ticketValue;
}

void ExecuteMoveToBreakeven(string payloadJson, string &ackStatus, string &ticket, string &brokerMessage)
{
   string ticketValue;
   string symbol;
   if (!ExtractJsonString(payloadJson, "ticket", ticketValue))
   {
      ackStatus = "failed";
      brokerMessage = "missing_ticket";
      return;
   }
   ExtractJsonString(payloadJson, "symbol", symbol);

   ulong positionTicket = ResolvePositionTicket(ticketValue, symbol);
   trade.SetDeviationInPoints(SlippagePoints);
   trade.SetExpertMagicNumber((ulong)MagicNumber);

   if (positionTicket <= 0 || !PositionSelectByTicket(positionTicket))
   {
      ackStatus = "failed";
      brokerMessage = "position_not_found";
      ticket = ticketValue;
      return;
   }

   string positionSymbol = PositionGetString(POSITION_SYMBOL);
   int digits = (int)SymbolInfoInteger(positionSymbol, SYMBOL_DIGITS);
   double entry = PositionGetDouble(POSITION_PRICE_OPEN);
   double currentTp = PositionGetDouble(POSITION_TP);
   double bufferPoints = 0.0;
   ExtractJsonNumber(payloadJson, "bufferPoints", bufferPoints);
   double point = SymbolInfoDouble(positionSymbol, SYMBOL_POINT);
   double buffer = bufferPoints > 0.0 ? bufferPoints * point : point;
   long positionType = PositionGetInteger(POSITION_TYPE);
   double breakEvenSl = positionType == POSITION_TYPE_BUY ? entry + buffer : entry - buffer;
   breakEvenSl = NormalizeDouble(breakEvenSl, digits);

   if (!trade.PositionModify(positionTicket, breakEvenSl, currentTp))
   {
      ackStatus = "failed";
      brokerMessage = trade.ResultRetcodeDescription();
      ticket = ticketValue;
      return;
   }

   ackStatus = "accepted";
   brokerMessage = "ok";
   ticket = ticketValue;
}

void ExecuteSetTrailingStop(string payloadJson, string &ackStatus, string &ticket, string &brokerMessage)
{
   string ticketValue;
   string symbol;
   double trailingPoints = 150.0;
   if (!ExtractJsonString(payloadJson, "ticket", ticketValue))
   {
      ackStatus = "failed";
      brokerMessage = "missing_ticket";
      return;
   }
   ExtractJsonString(payloadJson, "symbol", symbol);
   if (!ExtractJsonNumber(payloadJson, "trailingPoints", trailingPoints))
   {
      ExtractJsonNumber(payloadJson, "trailingDistance", trailingPoints);
   }

   ulong positionTicket = ResolvePositionTicket(ticketValue, symbol);
   trade.SetDeviationInPoints(SlippagePoints);
   trade.SetExpertMagicNumber((ulong)MagicNumber);

   if (positionTicket <= 0 || !PositionSelectByTicket(positionTicket))
   {
      ackStatus = "failed";
      brokerMessage = "position_not_found";
      ticket = ticketValue;
      return;
   }

   string positionSymbol = PositionGetString(POSITION_SYMBOL);
   int digits = (int)SymbolInfoInteger(positionSymbol, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(positionSymbol, SYMBOL_POINT);
   double distance = MathMax(point, trailingPoints * point);
   long positionType = PositionGetInteger(POSITION_TYPE);
   double currentTp = PositionGetDouble(POSITION_TP);
   double bid = 0.0;
   double ask = 0.0;
   SymbolInfoDouble(positionSymbol, SYMBOL_BID, bid);
   SymbolInfoDouble(positionSymbol, SYMBOL_ASK, ask);
   double trailingSl = positionType == POSITION_TYPE_BUY ? bid - distance : ask + distance;
   trailingSl = NormalizeDouble(trailingSl, digits);

   if (!trade.PositionModify(positionTicket, trailingSl, currentTp))
   {
      ackStatus = "failed";
      brokerMessage = trade.ResultRetcodeDescription();
      ticket = ticketValue;
      return;
   }

   ackStatus = "accepted";
   brokerMessage = "ok";
   ticket = ticketValue;
}

void ExecuteEmergencyCloseAll(string &ackStatus, string &brokerMessage)
{
   trade.SetDeviationInPoints(SlippagePoints);
   trade.SetExpertMagicNumber((ulong)MagicNumber);

   int total = PositionsTotal();
   bool anyFailed = false;
   for (int i = total - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if (!PositionSelectByTicket(ticket)) continue;
      string symbol = PositionGetString(POSITION_SYMBOL);
      if (!trade.PositionClose(symbol))
      {
         anyFailed = true;
      }
   }

   ackStatus = anyFailed ? "failed" : "accepted";
   brokerMessage = anyFailed ? "close_all_partial_failure" : "ok";
}

void PostAck(string commandId, string terminalId, string status, string ticket, string brokerMessage, double executedPrice, double executedVolumeLots, int slippagePoints, int spreadPoints, int latencyMs, string receivedType)
{
   string ack = StringFormat(
      "{\"commandId\":\"%s\",\"terminalId\":\"%s\",\"status\":\"%s\",\"ticket\":\"%s\",\"brokerMessage\":\"%s\",\"executedPrice\":%s,\"executedVolumeLots\":%s,\"slippagePoints\":%d,\"spreadPoints\":%d,\"latencyMs\":%d,\"receivedType\":\"%s\",\"receivedAt\":\"%s\"}",
      EscapeJson(commandId),
      EscapeJson(terminalId),
      EscapeJson(status),
      EscapeJson(ticket),
      EscapeJson(brokerMessage),
      DoubleToJson(executedPrice),
      DoubleToJson(executedVolumeLots),
      slippagePoints,
      spreadPoints,
      latencyMs,
      EscapeJson(receivedType),
      TimeToString(TimeLocal(), TIME_DATE | TIME_SECONDS)
   );

   string headers = "Content-Type: application/json\r\nX-Cacsms-Secret: " + BridgeSecret + "\r\n";
   char data[];
   char result[];
   string resultHeaders;
   StringToCharArray(ack, data, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(data, ArraySize(data) - 1);

   ResetLastError();
   int statusCode = WebRequest(
      "POST",
      BridgeUrl + "/commands/ack",
      headers,
      WebRequestTimeoutMs,
      data,
      result,
      resultHeaders
   );

   if (statusCode != 200)
   {
      Print("Cacsms ack failed. HTTP status: ", statusCode, " MT5 error: ", GetLastError(), " CommandId: ", commandId);
   }
}

int SymbolSpreadPoints(string symbol, bool available)
{
   if (!available) return 0;
   double bid = 0.0;
   double ask = 0.0;
   SymbolInfoDouble(symbol, SYMBOL_BID, bid);
   SymbolInfoDouble(symbol, SYMBOL_ASK, ask);
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   return point > 0.0 ? (int)MathRound((ask - bid) / point) : 0;
}

string EscapeJson(string value)
{
   string escaped = value;
   StringReplace(escaped, "\\", "\\\\");
   StringReplace(escaped, "\"", "\\\"");
   return escaped;
}

string UrlEncode(string value)
{
   string encoded = "";
   for (int i = 0; i < StringLen(value); i++)
   {
      ushort ch = StringGetCharacter(value, i);
      if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' || ch == '.' || ch == '~')
      {
         encoded += CharToString((uchar)ch);
      }
      else if (ch == ' ')
      {
         encoded += "%20";
      }
      else
      {
         encoded += "%" + StringFormat("%02X", (int)ch);
      }
   }
   return encoded;
}

ulong ResolvePositionTicket(string ticketValue, string symbol)
{
   ulong ticket = (ulong)StringToInteger(ticketValue);
   if (ticket > 0 && PositionSelectByTicket(ticket))
   {
      return ticket;
   }

   string normalizedSymbol = symbol;
   StringTrimLeft(normalizedSymbol);
   StringTrimRight(normalizedSymbol);
   for (int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong posTicket = PositionGetTicket(i);
      if (!PositionSelectByTicket(posTicket)) continue;
      if (normalizedSymbol != "" && PositionGetString(POSITION_SYMBOL) != normalizedSymbol) continue;
      if ((ulong)PositionGetInteger(POSITION_MAGIC) != (ulong)MagicNumber) continue;
      return posTicket;
   }
   return 0;
}

ulong ResolveLatestPositionTicket(string symbol)
{
   return ResolvePositionTicket("", symbol);
}

double NormalizeVolume(double lots, double minLot, double maxLot, double step)
{
   if (lots < minLot) lots = minLot;
   if (lots > maxLot) lots = maxLot;
   if (step <= 0.0) step = minLot;
   double steps = MathFloor(lots / step);
   double normalized = steps * step;
   if (normalized < minLot) normalized = minLot;
   normalized = NormalizeDouble(normalized, 2);
   return normalized;
}

string DoubleToJson(double value)
{
   if (!MathIsValidNumber(value) || value == 0.0)
   {
      return "0";
   }
   return DoubleToString(value, 6);
}

string ReadBridgeErrorBody(string body)
{
   string errorMessage = "";
   if (ExtractJsonString(body, "error", errorMessage) && errorMessage != "")
   {
      return errorMessage;
   }
   return TruncateString(body, 240);
}

bool ExtractJsonString(string json, string key, string &outValue)
{
   string raw;
   if (!ExtractJsonRawValue(json, key, raw))
   {
      return false;
   }
   raw = StringTrim(raw);
   if (StringLen(raw) < 2 || StringGetCharacter(raw, 0) != '"' || StringGetCharacter(raw, StringLen(raw) - 1) != '"')
   {
      return false;
   }
   outValue = UnescapeJsonString(StringSubstr(raw, 1, StringLen(raw) - 2));
   return true;
}

bool ExtractJsonNumber(string json, string key, double &outValue)
{
   string raw;
   if (!ExtractJsonRawValue(json, key, raw))
   {
      return false;
   }
   raw = StringTrim(raw);
   if (raw == "null" || raw == "")
   {
      return false;
   }
   outValue = StringToDouble(raw);
   return MathIsValidNumber(outValue);
}

bool ExtractJsonObject(string json, string key, string &outObjectJson, bool &isNull)
{
   isNull = false;
   int pos = FindJsonKey(json, key);
   if (pos < 0) return false;
   int colon = FindColonAfter(json, pos);
   if (colon < 0) return false;
   int valueStart = SkipWhitespace(json, colon + 1);
   if (valueStart < 0) return false;
   if (StringSubstr(json, valueStart, 4) == "null")
   {
      isNull = true;
      outObjectJson = "";
      return true;
   }
   if (StringGetCharacter(json, valueStart) != '{')
   {
      return false;
   }
   int endPos = FindMatchingBracket(json, valueStart, '{', '}');
   if (endPos < 0) return false;
   outObjectJson = StringSubstr(json, valueStart, endPos - valueStart + 1);
   return true;
}

bool ExtractJsonRawValue(string json, string key, string &outRaw)
{
   int pos = FindJsonKey(json, key);
   if (pos < 0) return false;
   int colon = FindColonAfter(json, pos);
   if (colon < 0) return false;
   int valueStart = SkipWhitespace(json, colon + 1);
   if (valueStart < 0) return false;
   int valueEnd = FindJsonValueEnd(json, valueStart);
   if (valueEnd < valueStart) return false;
   outRaw = StringSubstr(json, valueStart, valueEnd - valueStart + 1);
   return true;
}

int FindJsonKey(string json, string key)
{
   string needle = "\"" + key + "\"";
   int pos = StringFind(json, needle, 0);
   return pos;
}

int FindColonAfter(string json, int startPos)
{
   bool inString = false;
   for (int i = startPos; i < StringLen(json); i++)
   {
      ushort ch = StringGetCharacter(json, i);
      if (ch == '"' && (i == 0 || StringGetCharacter(json, i - 1) != '\\'))
      {
         inString = !inString;
      }
      if (!inString && ch == ':')
      {
         return i;
      }
   }
   return -1;
}

int SkipWhitespace(string json, int startPos)
{
   for (int i = startPos; i < StringLen(json); i++)
   {
      ushort ch = StringGetCharacter(json, i);
      if (ch != ' ' && ch != '\r' && ch != '\n' && ch != '\t')
      {
         return i;
      }
   }
   return -1;
}

int FindMatchingBracket(string json, int startPos, ushort openChar, ushort closeChar)
{
   int depth = 0;
   bool inString = false;
   for (int i = startPos; i < StringLen(json); i++)
   {
      ushort ch = StringGetCharacter(json, i);
      if (ch == '"' && (i == 0 || StringGetCharacter(json, i - 1) != '\\'))
      {
         inString = !inString;
      }
      if (inString) continue;
      if (ch == openChar) depth++;
      if (ch == closeChar)
      {
         depth--;
         if (depth == 0) return i;
      }
   }
   return -1;
}

int FindJsonValueEnd(string json, int valueStart)
{
   ushort ch = StringGetCharacter(json, valueStart);
   if (ch == '"')
   {
      for (int i = valueStart + 1; i < StringLen(json); i++)
      {
         ushort c = StringGetCharacter(json, i);
         if (c == '"' && StringGetCharacter(json, i - 1) != '\\')
         {
            return i;
         }
      }
      return -1;
   }
   if (ch == '{')
   {
      return FindMatchingBracket(json, valueStart, '{', '}');
   }
   if (ch == '[')
   {
      return FindMatchingBracket(json, valueStart, '[', ']');
   }
   bool inString = false;
   for (int i = valueStart; i < StringLen(json); i++)
   {
      ushort c = StringGetCharacter(json, i);
      if (c == '"' && (i == 0 || StringGetCharacter(json, i - 1) != '\\'))
      {
         inString = !inString;
      }
      if (inString) continue;
      if (c == ',' || c == '}' || c == ']')
      {
         return i - 1;
      }
   }
   return StringLen(json) - 1;
}

string StringTrim(string value)
{
   string out = value;
   StringTrimLeft(out);
   StringTrimRight(out);
   return out;
}

string UnescapeJsonString(string value)
{
   string out = value;
   StringReplace(out, "\\\"", "\"");
   StringReplace(out, "\\\\", "\\");
   StringReplace(out, "\\n", "\n");
   StringReplace(out, "\\r", "\r");
   StringReplace(out, "\\t", "\t");
   return out;
}
