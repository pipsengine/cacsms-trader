//+------------------------------------------------------------------+
//| Cacsms Trader EA                                                 |
//| Demo heartbeat bridge first, execution later.                     |
//+------------------------------------------------------------------+
#property strict
#property version "0.1.0"

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

CTrade trade;

datetime lastHeartbeat = 0;
datetime eaStartedAt = 0;
long heartbeatSequence = 0;
int lastWebRequestLatencyMs = 0;
datetime lastCommandPoll = 0;

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
   // Execution remains disabled until command polling and risk acknowledgments exist.
}

void OnTimer()
{
   datetime now = TimeCurrent();
   if (lastHeartbeat == 0 || (now - lastHeartbeat) >= HeartbeatSeconds)
   {
      SendHeartbeat();
   }
   if (CommandPollSeconds > 0 && (lastCommandPoll == 0 || (now - lastCommandPoll) >= CommandPollSeconds))
   {
      lastCommandPoll = now;
      PollNextCommand();
   }
}

void SendHeartbeat()
{
   lastHeartbeat = TimeCurrent();
   heartbeatSequence++;

   string computerId = TerminalInfoString(TERMINAL_DATA_PATH);
   string computerName = TerminalInfoString(TERMINAL_NAME);
   string nigeriaTime = TimeToString((datetime)(TimeGMT() + 3600), TIME_DATE | TIME_SECONDS);
   string connectionStatus = "connected";
   string heartbeat = StringFormat(
      "{\"terminalId\":\"%s\",\"computerId\":\"%s\",\"computerName\":\"%s\",\"accountNumber\":\"%I64d\",\"brokerName\":\"%s\",\"serverName\":\"%s\",\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,\"freeMargin\":%.2f,\"openOrders\":%d,\"connectionStatus\":\"%s\",\"lastTickTime\":\"%s\",\"mt5ServerTime\":\"%s\",\"terminalTime\":\"%s\",\"nigeriaTime\":\"%s\",\"sentAt\":\"%s\",\"heartbeatIntervalSeconds\":%d,\"sequence\":%I64d,\"latencyMs\":%d,\"eaStartedAt\":\"%s\",\"version\":\"0.2.0\"}",
      EscapeJson(TerminalId),
      EscapeJson(computerId),
      EscapeJson(computerName),
      AccountInfoInteger(ACCOUNT_LOGIN),
      EscapeJson(AccountInfoString(ACCOUNT_COMPANY)),
      EscapeJson(AccountInfoString(ACCOUNT_SERVER)),
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_FREEMARGIN),
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

   Print("Cacsms heartbeat failed. Sequence: ", heartbeatSequence, " HTTP status: ", statusCode, " MT5 error: ", GetLastError(), " Latency: ", lastWebRequestLatencyMs, "ms");
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
      Print("Cacsms command poll failed. HTTP status: ", statusCode, " MT5 error: ", GetLastError(), " Latency: ", latencyMs, "ms");
      return;
   }

   string body = CharArrayToString(result, 0, -1, CP_UTF8);
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
   string type;
   string terminalId;
   string payloadJson;
   if (!ExtractJsonString(commandJson, "commandId", commandId)) return;
   if (!ExtractJsonString(commandJson, "type", type)) return;
   if (!ExtractJsonString(commandJson, "terminalId", terminalId)) terminalId = TerminalId;
   bool payloadNull = false;
   if (!ExtractJsonObject(commandJson, "payload", payloadJson, payloadNull)) payloadJson = "{}";

   string ackStatus = "failed";
   string ticket = "";
   string brokerMessage = "";
   double executedPrice = 0.0;
   double executedVolumeLots = 0.0;

   if (!EnableExecution)
   {
      ackStatus = "rejected";
      brokerMessage = "execution_disabled";
   }
   else
   {
      ExecuteCommand(type, payloadJson, ackStatus, ticket, brokerMessage, executedPrice, executedVolumeLots);
   }

   PostAck(commandId, terminalId, ackStatus, ticket, brokerMessage, executedPrice, executedVolumeLots, latencyMs);
}

void ExecuteCommand(string type, string payloadJson, string &ackStatus, string &ticket, string &brokerMessage, double &executedPrice, double &executedVolumeLots)
{
   string normalized = StringToLower(type);
   if (normalized == "place_order")
   {
      ExecutePlaceOrder(payloadJson, ackStatus, ticket, brokerMessage, executedPrice, executedVolumeLots);
      return;
   }
   if (normalized == "close_order")
   {
      ExecuteCloseOrder(payloadJson, ackStatus, ticket, brokerMessage);
      return;
   }
   if (normalized == "modify_order")
   {
      ExecuteModifyOrder(payloadJson, ackStatus, ticket, brokerMessage);
      return;
   }
   if (normalized == "emergency_close_all")
   {
      ExecuteEmergencyCloseAll(ackStatus, brokerMessage);
      return;
   }
   ackStatus = "failed";
   brokerMessage = "unsupported_command_type";
}

void ExecutePlaceOrder(string payloadJson, string &ackStatus, string &ticket, string &brokerMessage, double &executedPrice, double &executedVolumeLots)
{
   string symbol;
   string side;
   string orderKind;
   double volumeLots = 0.0;
   double stopLoss = 0.0;
   double takeProfit = 0.0;

   if (!ExtractJsonString(payloadJson, "symbol", symbol)) { ackStatus = "failed"; brokerMessage = "missing_symbol"; return; }
   if (!ExtractJsonString(payloadJson, "side", side)) { ackStatus = "failed"; brokerMessage = "missing_side"; return; }
   if (!ExtractJsonString(payloadJson, "orderKind", orderKind)) orderKind = "market";
   if (!ExtractJsonNumber(payloadJson, "volumeLots", volumeLots)) { ackStatus = "failed"; brokerMessage = "missing_volumeLots"; return; }
   if (!ExtractJsonNumber(payloadJson, "stopLoss", stopLoss)) { ackStatus = "failed"; brokerMessage = "missing_stopLoss"; return; }
   if (!ExtractJsonNumber(payloadJson, "takeProfit", takeProfit)) { ackStatus = "failed"; brokerMessage = "missing_takeProfit"; return; }

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
   string sideLower = StringToLower(side);
   if (sideLower == "buy")
   {
      ok = trade.Buy(normalizedLots, symbol, 0.0, stopLoss, takeProfit, "cacsms");
   }
   else if (sideLower == "sell")
   {
      ok = trade.Sell(normalizedLots, symbol, 0.0, stopLoss, takeProfit, "cacsms");
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
   executedVolumeLots = normalizedLots;
   ticket = (string)(deal > 0 ? deal : order);
   ackStatus = "filled";
   brokerMessage = "ok";
}

void ExecuteCloseOrder(string payloadJson, string &ackStatus, string &ticket, string &brokerMessage)
{
   string ticketValue;
   double volumeLots = 0.0;
   if (!ExtractJsonString(payloadJson, "ticket", ticketValue))
   {
      ackStatus = "failed";
      brokerMessage = "missing_ticket";
      return;
   }
   ExtractJsonNumber(payloadJson, "volumeLots", volumeLots);

   ulong positionTicket = (ulong)StringToInteger(ticketValue);
   trade.SetDeviationInPoints(SlippagePoints);
   trade.SetExpertMagicNumber((ulong)MagicNumber);

   bool ok = false;
   if (PositionSelectByTicket(positionTicket))
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
   double stopLoss = 0.0;
   double takeProfit = 0.0;

   if (!ExtractJsonString(payloadJson, "ticket", ticketValue))
   {
      ackStatus = "failed";
      brokerMessage = "missing_ticket";
      return;
   }
   if (!ExtractJsonNumber(payloadJson, "stopLoss", stopLoss)) stopLoss = 0.0;
   if (!ExtractJsonNumber(payloadJson, "takeProfit", takeProfit)) takeProfit = 0.0;

   ulong positionTicket = (ulong)StringToInteger(ticketValue);
   trade.SetDeviationInPoints(SlippagePoints);
   trade.SetExpertMagicNumber((ulong)MagicNumber);

   bool ok = false;
   if (PositionSelectByTicket(positionTicket))
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

void PostAck(string commandId, string terminalId, string status, string ticket, string brokerMessage, double executedPrice, double executedVolumeLots, int latencyMs)
{
   string ack = StringFormat(
      "{\"commandId\":\"%s\",\"terminalId\":\"%s\",\"status\":\"%s\",\"ticket\":\"%s\",\"brokerMessage\":\"%s\",\"executedPrice\":%s,\"executedVolumeLots\":%s,\"latencyMs\":%d,\"receivedAt\":\"%s\"}",
      EscapeJson(commandId),
      EscapeJson(terminalId),
      EscapeJson(status),
      EscapeJson(ticket),
      EscapeJson(brokerMessage),
      DoubleToJson(executedPrice),
      DoubleToJson(executedVolumeLots),
      latencyMs,
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
