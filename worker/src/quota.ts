import type { Env, QuotaClaim } from "./types";

interface IpUsage {
  count: number;
  active: number;
}

interface QuotaState {
  day: string;
  globalCount: number;
  ips: Record<string, IpUsage>;
}

function currentDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyState(day: string): QuotaState {
  return { day, globalCount: 0, ips: {} };
}

export class QuotaStore implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    _env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST") {
      return Response.json(
        { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
        { status: 405 },
      );
    }

    if (url.pathname === "/claim") {
      const claim = (await request.json()) as QuotaClaim;
      return this.claim(claim);
    }
    if (url.pathname === "/release") {
      const { ip } = (await request.json()) as { ip: string };
      return this.release(ip);
    }

    return Response.json(
      { code: "NOT_FOUND", message: "Not found" },
      { status: 404 },
    );
  }

  private async claim(claim: QuotaClaim): Promise<Response> {
    const day = currentDay();
    let result = { status: 200, code: "OK" };

    await this.state.storage.transaction(async (transaction) => {
      const stored = (await transaction.get<QuotaState>("state")) ??
        emptyState(day);
      const quota = stored.day === day ? stored : emptyState(day);
      const ipUsage = quota.ips[claim.ip] ?? { count: 0, active: 0 };

      if (quota.globalCount >= claim.dailyGlobalLimit) {
        result = { status: 429, code: "GLOBAL_QUOTA_EXCEEDED" };
        return;
      }
      if (ipUsage.count >= claim.dailyIpLimit) {
        result = { status: 429, code: "IP_QUOTA_EXCEEDED" };
        return;
      }
      if (ipUsage.active >= claim.maxConcurrentPerIp) {
        result = { status: 429, code: "IP_CONCURRENCY_EXCEEDED" };
        return;
      }

      quota.globalCount += 1;
      ipUsage.count += 1;
      ipUsage.active += 1;
      quota.ips[claim.ip] = ipUsage;
      await transaction.put("state", quota);
    });

    if (result.status !== 200) {
      return Response.json(
        {
          code: result.code,
          message:
            result.code === "IP_CONCURRENCY_EXCEEDED"
              ? "当前网络同时进行的翻译请求过多，请稍后重试"
              : "今日公开额度已用完，请明日再试",
        },
        { status: result.status },
      );
    }

    return Response.json({ code: "OK" });
  }

  private async release(ip: string): Promise<Response> {
    const day = currentDay();
    await this.state.storage.transaction(async (transaction) => {
      const stored = (await transaction.get<QuotaState>("state")) ??
        emptyState(day);
      if (stored.day !== day) {
        return;
      }
      const usage = stored.ips[ip];
      if (!usage) {
        return;
      }
      usage.active = Math.max(0, usage.active - 1);
      stored.ips[ip] = usage;
      await transaction.put("state", stored);
    });
    return Response.json({ code: "OK" });
  }
}
