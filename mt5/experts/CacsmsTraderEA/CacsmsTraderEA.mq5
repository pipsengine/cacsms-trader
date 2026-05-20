//+------------------------------------------------------------------+
//| Cacsms Trader EA                                                 |
//| Demo heartbeat bridge first, execution later.                     |
//+------------------------------------------------------------------+
#property strict
#property version "0.1.0"

input string TerminalId = "UNCONFIGURED";
input string BridgeUrl = "http://127.0.0.1:8787";
input string BridgeSecret = "mt5_cacsms";
input int HeartbeatSeconds = 5;
input int WebRequestTimeoutMs = 5000;

datetime lastHeartbeat = 0;
datetime eaStartedAt = 0;
long heartbeatSequence = 0;
int lastWebRequestLatencyMs = 0;

int OnInit()
{
   eaStartedAt = TimeLocal();
   EventSetTimer(HeartbeatSeconds);
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
   SendHeartbeat();
}

void SendHeartbeat()
{
   lastHeartbeat = TimeCurrent();
   heartbeatSequence++;

   string heartbeat = StringFormat(
      "{\"terminalId\":\"%s\",\"computerName\":\"%s\",\"accountNumber\":\"%I64d\",\"brokerName\":\"%s\",\"serverName\":\"%s\",\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,\"freeMargin\":%.2f,\"openOrders\":%d,\"lastTickTime\":\"%s\",\"mt5ServerTime\":\"%s\",\"terminalTime\":\"%s\",\"sentAt\":\"%s\",\"heartbeatIntervalSeconds\":%d,\"sequence\":%I64d,\"latencyMs\":%d,\"eaStartedAt\":\"%s\",\"version\":\"0.2.0\"}",
      EscapeJson(TerminalId),
      EscapeJson(TerminalInfoString(TERMINAL_NAME)),
      AccountInfoInteger(ACCOUNT_LOGIN),
      EscapeJson(AccountInfoString(ACCOUNT_COMPANY)),
      EscapeJson(AccountInfoString(ACCOUNT_SERVER)),
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_FREEMARGIN),
      OrdersTotal(),
      TimeToString(lastHeartbeat, TIME_DATE | TIME_SECONDS),
      TimeToString(lastHeartbeat, TIME_DATE | TIME_SECONDS),
      TimeToString(TimeLocal(), TIME_DATE | TIME_SECONDS),
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

string EscapeJson(string value)
{
   string escaped = value;
   StringReplace(escaped, "\\", "\\\\");
   StringReplace(escaped, "\"", "\\\"");
   return escaped;
}
