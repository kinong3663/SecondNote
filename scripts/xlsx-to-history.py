#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ReLive · 从保利威后台导出的 Excel / CSV 还原三线数据（不需要 appId / appSecret）

用法：
    python scripts/xlsx-to-history.py --inspect public/data/chat.xlsx public/data/concurrency.xlsx
    python scripts/xlsx-to-history.py public/data/chat.xlsx public/data/concurrency.xlsx
    python scripts/xlsx-to-history.py --bucket 60 public/data/xxx.xlsx

它会：
  1. 逐个 sheet 猜表头（时间列 / 弹幕内容列 / 人数量列）
  2. --inspect：只报告"这个文件能不能用、缺哪个字段"，不改数据
  3. 正常模式：合并成 public/data/history.json（和 HAR 那条路同一个格式）

判断标准（很重要）：
  ✅ 能用：弹幕表有「内容 + 秒级时间戳」；并发表有「时间序列 + 人数」
  ❌ 不能用：只有日汇总（观看人次 / 最高并发 一个数字）→ 对彩排没有价值
"""
import argparse
import json
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    sys.exit("缺 pandas。用 bundled python 跑：见 load_workspace_dependencies 给出的 python 路径。")

# Windows 控制台默认 GBK，打印 ✅/❌ 会炸，强制 UTF-8
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

CST = timezone(timedelta(hours=8))

TIME_PAT = re.compile(r"时间|时刻|日期|^time|_time|timestamp|^ts$|发送", re.I)
TEXT_PAT = re.compile(r"内容|消息|聊天|发言|弹幕|文本|content|msg|text|chat", re.I)
COUNT_PAT = re.compile(r"人数|并发|在线|数量|观看|峰值|^count|^num|viewer|online", re.I)


def to_ms(value):
    """把单元格转成毫秒时间戳；认不出就返回 None。"""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (int, float)):
        v = float(value)
        if v > 1e12:      # 毫秒
            return int(v)
        if v > 1e9:       # 秒
            return int(v * 1000)
        return None
    s = str(value).strip()
    if not s:
        return None
    if re.fullmatch(r"\d{13}", s):
        return int(s)
    if re.fullmatch(r"\d{10}", s):
        return int(s) * 1000
    # 中文/常规日期时间
    s = s.replace("/", "-").replace("年", "-").replace("月", "-").replace("日", " ")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S.%f", "%H:%M:%S", "%H:%M"):
        try:
            dt = datetime.strptime(s.strip(), fmt)
            if dt.year == 1900:  # 只有时分秒
                dt = dt.replace(year=2026, month=1, day=1)
            return int(dt.replace(tzinfo=CST).timestamp() * 1000)
        except ValueError:
            continue
    return None


def classify(df):
    """猜这个 sheet 是什么类型，返回 (kind, time_col, payload_col, note)"""
    cols = [str(c) for c in df.columns]
    time_col = next((c for c in cols if TIME_PAT.search(c)), None)
    text_col = next((c for c in cols if TEXT_PAT.search(c)), None)
    count_col = next((c for c in cols if COUNT_PAT.search(c)), None)

    if time_col is None:
        return None, None, None, "找不到时间列（表头里没有 时间/日期/time）"

    # 用第一列数据验证时间列真的可解析
    parsed = df[time_col].map(to_ms)
    hit = int(parsed.notna().sum())
    if hit < 3:
        return None, time_col, None, f"时间列「{time_col}」只有 {hit} 行能解析"

    if text_col is not None:
        return "chat", time_col, text_col, f"弹幕表：{hit} 条可解析时间"
    if count_col is not None:
        return "online", time_col, count_col, f"并发表：{hit} 个可解析时间点"
    return None, time_col, None, "有时间列，但既没有内容列也没有人数量列"


def load(path):
    p = Path(path)
    if not p.exists():
        print(f"  ❌ 文件不存在：{p}")
        return []
    suffix = p.suffix.lower()
    if suffix in (".csv", ".txt"):
        out = []
        for enc in ("utf-8-sig", "gbk", "utf-8"):
            try:
                out.append((p.stem, pd.read_csv(p, encoding=enc)))
                break
            except Exception:
                continue
        return out
    sheets = pd.read_excel(p, sheet_name=None)
    return [(f"{p.stem}/{name}", df) for name, df in sheets.items()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--inspect", action="store_true")
    ap.add_argument("--bucket", type=int, default=5)
    ap.add_argument("--out", default="public/data/history.json")
    args = ap.parse_args()

    chat_ms, online = [], []
    usable = False

    print(f"检查 {len(args.files)} 个文件\n")
    for f in args.files:
        for sheet_name, df in load(f):
            if df.empty:
                continue
            kind, tcol, pcol, note = classify(df)
            flag = "✅" if kind else "❌"
            print(f"{flag} {sheet_name}  [{df.shape[0]} 行 × {df.shape[1]} 列]")
            print(f"   列：{', '.join(str(c) for c in df.columns[:12])}")
            print(f"   {note}")
            if not kind:
                print()
                continue
            usable = True
            if kind == "chat":
                times = df[tcol].map(to_ms).dropna().astype("int64").tolist()
                chat_ms.extend(times)
                print(f"   → 弹幕 {len(times)} 条，{datetime.fromtimestamp(min(times)/1000, CST):%Y-%m-%d %H:%M} 起")
            else:
                pairs = [(to_ms(t), c) for t, c in zip(df[tcol], df[pcol])]
                pairs = [(t, float(c)) for t, c in pairs if t and pd.notna(c)]
                online.extend(pairs)
                print(f"   → 并发 {len(pairs)} 个点")
            print()

    if not usable:
        print("❌ 这批文件全都没法用。缺的通常是：弹幕的秒级时间戳、或并发的时间序列。")
        print("   → 走 HAR 那条路更稳：npm run data:har:inspect")
        sys.exit(1)

    if args.inspect:
        print("--inspect：只做体检，不写文件。")
        return

    base = min([t for t, _ in online] + chat_ms) if (online or chat_ms) else 0
    n_bucket = args.bucket
    buckets = {}

    def slot(ms):
        sec = (ms - base) / 1000
        b = int(sec // n_bucket) * n_bucket
        return buckets.setdefault(b, {"t": b, "online": 0, "chat": 0, "sentiment": 0})

    for ms, cnt in online:
        slot(ms)["online"] = int(round(cnt))
    for ms in chat_ms:
        slot(ms)["chat"] += 1

    series = [buckets[k] for k in sorted(buckets)]
    last = next((s["online"] for s in series if s["online"] > 0), 0)
    for s in series:
        if not s["online"]:
            s["online"] = last
        else:
            last = s["online"]

    history = {
        "meta": {
            "channelId": "4711207",
            "title": "后台导出还原",
            "date": datetime.now(CST).strftime("%Y-%m-%d"),
            "durationSec": series[-1]["t"] if series else 0,
            "bucketSec": n_bucket,
            "source": "xlsx",
            "generatedAt": datetime.now(CST).isoformat(),
            "files": [str(Path(f).name) for f in args.files],
        },
        "segments": [],
        "series": series,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ {out}  {len(series)} 个采样点 / {history['meta']['durationSec']}s")
    if series:
        print(f"   在线人数 {series[0]['online']} → {series[-1]['online']}，弹幕 {len(chat_ms)} 条")


if __name__ == "__main__":
    main()
