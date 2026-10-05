# -*- coding: utf-8 -*-
"""
사이즈표 스펙 추출 POC (스키마 v1.1)
- 라벨_초안 폴더의 정답 JSON과 같은 이미지를 Gemini에 넣어 추출하고, 정답과 비교해 정확도를 계산한다.
- 1차 추출 후 검증 규칙에 걸리면 오류 내용을 알려주고 1회 재추출한다(자기수정 루프 시험).

실행:  python poc_extract.py               (모든 라벨 대상)
       python poc_extract.py --model gemini-2.5-flash
       python poc_extract.py --selftest    (API 없이 비교 로직만 점검)
필요:  pip install requests
키:    ..\gemini_key.txt 에 API 키 한 줄
"""
import argparse, base64, json, os, re, sys, time, glob, copy
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # 캡스톤2
IMG_DIR = os.path.join(ROOT, "사이즈표")
LABEL_DIRS = {"dev": os.path.join(IMG_DIR, "라벨_초안"), "test": os.path.join(IMG_DIR, "라벨_테스트")}
OUT_DIR = os.path.join(HERE, "결과")
API = "https://generativelanguage.googleapis.com/v1beta"

# ---------------------------------------------------------------- 프롬프트
PROMPT = """너는 중국 쇼핑몰(타오바오·티몰·1688) 의류 사이즈표 이미지를 구조화 데이터로 옮기는 추출기다.
이미지에 적힌 그대로 읽어서 아래 JSON 형식으로만 답하라. 설명 문장은 쓰지 마라.

{
  "category": "상의" | "하의" | "원피스",
  "weightUnit": "kg" | "斤" | "추정_kg" | "추정_斤" | "없음",
  "variants": [
    {
      "name": 표가 여러 개일 때 표 이름(예 "长款", "加长版 108CM"), 하나면 null,
      "fitHeightCm": 권장 키가 사이즈가 아니라 표(버전) 전체에 붙어 있으면 [최소,최대], 아니면 null,
      "sizes": [
        {
          "label": 사이즈 원문 그대로 (예 "110", "160/84A/S", "M/2尺", "W29"),
          "heightCm": [최소,최대] 또는 null,
          "weightKg": [최소,최대] 또는 null,
          "ageYears": [최소,최대] 또는 null,
          "length": 총장 숫자(衣长/裙长/裤长/总长) 또는 null,
          "chest": {"value": 숫자 또는 [최소,최대], "basis": "단면"|"둘레"|"불명"} 또는 null,
          "waist": 위와 같은 형식 또는 null,
          "hip": 위와 같은 형식 또는 null,
          "shoulder": 숫자 또는 null,
          "sleeve": {"value": 숫자, "from": "어깨"|"목"|"불명"} 또는 null,
          "extra": {"원문 머리글": "원문 값", ...}
        }
      ]
    }
  ],
  "fitMatrix": 키×몸무게→사이즈 매트릭스가 있으면 {"heightCm":[...], "weightKg":[...], "cells":[[...]]}, 없으면 null
}

규칙:
1. 斤(진)은 0.5kg이다. 斤 값은 2로 나눠 weightKg에 넣고 weightUnit은 "斤". 단위가 안 적혀 있으면 키 대비 몸무게가 자연스러운 쪽으로 판단해 "추정_斤" 또는 "추정_kg".
2. 범위 "100-110"은 [100,110], 단일값 "110"은 [110,110], 상한이 없으면("14岁以上") [14,null]. 개월(个月)은 12로 나눠 ageYears.
3. "36*2", "35×2" 표기는 value 36, basis "단면". 머리글이 "胸围1/2"이면 basis "단면". 그 외에는 값의 크기로 단면/둘레를 판단하고, 판단할 수 없으면 "불명". "平铺测量" 문구만으로 단면이라고 판단하지 마라.
4. 连肩袖长, 또는 袖长인데 값이 목 뒤 중심부터 잰 화장 수준이면 sleeve.from "목", 어깨부터면 "어깨".
5. 기본 칸(키, 몸무게, 나이, 총장, 가슴, 허리, 엉덩이, 어깨, 소매)이 아닌 치수(下摆, 袖口, 脚口, 裤脚, 档深, 前档, 后档, 股下, 大腿围, 后中长, 充绒量 등)는 extra에 원문 머리글과 원문 값 그대로 넣는다.
6. 사이즈가 가로로 나열된 표도 사이즈별로 나눠 적는다. 권장 키·몸무게 표가 따로 있으면 사이즈 라벨로 합친다.
7. 값이 "/", "-", 빈칸이면 null. 판매자 실수로 보여도 고치지 말고 적힌 그대로 적는다.
8. 길이 버전(小个子/常规款/高个子 등)이 열로 나열된 표는 버전별 variants로 나누고, 각 버전의 length에 그 열의 값을 넣는다.
9. 총장 머리글이 둘 이상이면(예: 衣长과 裙长이 함께 있음) length는 null로 두고 둘 다 extra에 넣는다.
10. 치수가 아닌 속성 칸(备注, 是否开裆 등)은 기록하지 않는다.
"""

# ---------------------------------------------------------------- Gemini 호출
def load_key():
    p = os.path.join(ROOT, "gemini_key.txt")
    if not os.path.exists(p):
        sys.exit(f"API 키 파일이 없습니다: {p}")
    return open(p, encoding="utf-8").read().strip()

def pick_model(key):
    import requests
    r = requests.get(f"{API}/models", params={"pageSize": 200}, headers={"x-goog-api-key": key}, timeout=30)
    r.raise_for_status()
    names = [m["name"].split("/")[-1] for m in r.json().get("models", [])
             if "generateContent" in m.get("supportedGenerationMethods", [])]
    bad = ("lite", "image", "tts", "live", "audio", "embedding", "exp", "preview", "8b")
    cands = [n for n in names if "flash" in n and not any(b in n for b in bad)]
    if not cands:
        cands = [n for n in names if "flash" in n] or names
    def ver(n):
        m = re.search(r"gemini-(\d+(?:\.\d+)?)", n)
        return float(m.group(1)) if m else 0
    cands.sort(key=ver, reverse=True)
    return cands, names

def mime_of(path):
    ext = os.path.splitext(path)[1].lower()
    return {".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}.get(ext, "image/png")

def call_gemini(key, model, image_paths, extra_text=None):
    import requests
    parts = []
    for p in image_paths:
        parts.append({"inline_data": {"mime_type": mime_of(p),
                                      "data": base64.b64encode(open(p, "rb").read()).decode()}})
    parts.append({"text": PROMPT + ("\n\n" + extra_text if extra_text else "")})
    body = {"contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"temperature": 0, "responseMimeType": "application/json"}}
    waits = [10, 20, 40, 60]
    for attempt in range(len(waits) + 1):
        try:
            r = requests.post(f"{API}/models/{model}:generateContent",
                              headers={"x-goog-api-key": key}, json=body, timeout=180)
        except requests.exceptions.RequestException as e:
            code, msg = None, str(e)
        else:
            if r.status_code == 200:
                data = r.json()
                cand = (data.get("candidates") or [{}])[0]
                text = "".join(p.get("text", "") for p in cand.get("content", {}).get("parts", []))
                return text, data.get("usageMetadata", {})
            code, msg = r.status_code, r.text[:1500]
            if code not in (429, 500, 502, 503, 504):
                raise RuntimeError(f"Gemini 오류 {code}: {msg}")
        if attempt < len(waits):
            hint = ""
            if code == 429 and msg:
                m = re.search(r'"(quota\w*|quotaMetric|quotaId)"\s*:\s*"([^"]+)"', msg)
                hint = f" [{m.group(2)}]" if m else ""
            print(f"   서버 응답 {code} (혼잡/제한){hint} → {waits[attempt]}초 후 재시도")
            time.sleep(waits[attempt])
    raise RuntimeError(f"재시도 후에도 실패 (마지막 응답 {code})")

# ---------------------------------------------------------------- 검증 규칙 (결정적 코드)
def nums(v):
    if v is None: return []
    if isinstance(v, (int, float)): return [v]
    if isinstance(v, list): return [x for x in v if isinstance(x, (int, float))]
    return []

def validate(spec):
    errs = []
    if not isinstance(spec, dict) or "variants" not in spec or not spec["variants"]:
        return ["JSON 형식이 스키마와 다르거나 variants가 비어 있음"]
    for vi, v in enumerate(spec["variants"]):
        sizes = v.get("sizes") or []
        if not sizes:
            errs.append(f"variants[{vi}]에 sizes가 없음"); continue
        labels = [s.get("label") for s in sizes]
        if len(set(labels)) != len(labels):
            errs.append(f"variants[{vi}] 사이즈 라벨 중복: {labels} (원본이 그런지 다시 확인)")
        # 단조 감소 검사 (같거나 커져야 정상)
        for f in ["length", "shoulder"]:
            seq = [s.get(f) for s in sizes if isinstance(s.get(f), (int, float))]
            if any(b < a for a, b in zip(seq, seq[1:])):
                errs.append(f"variants[{vi}] {f} 값이 사이즈가 커지는데 줄어듦: {seq} (원본이 그런지 다시 확인)")
        for f in ["chest", "waist", "hip"]:
            seq = [nums(s.get(f, {}).get("value"))[0] for s in sizes if isinstance(s.get(f), dict) and nums(s[f].get("value"))]
            if any(b < a for a, b in zip(seq, seq[1:])):
                errs.append(f"variants[{vi}] {f} 값이 사이즈가 커지는데 줄어듦: {seq} (원본이 그런지 다시 확인)")
        # 키 대비 몸무게 (단위 오류 검출)
        for s in sizes:
            h, w = s.get("heightCm"), s.get("weightKg")
            if h and w and len(h) == 2 and len(w) == 2 and h[0] and h[1]:
                hm = (h[0] + h[1]) / 200; wm = (w[0] + w[1]) / 2
                bmi = wm / (hm * hm) if hm else 0
                if bmi > 32 or bmi < 10:
                    errs.append(f"사이즈 {s.get('label')}: 키 {h} 대비 몸무게 {w}kg 은 BMI {bmi:.1f}로 비현실적 → 斤/kg 단위 확인")
                    break
    return errs

def parse(text):
    t = text.strip()
    t = re.sub(r"^```(?:json)?|```$", "", t, flags=re.M).strip()
    return json.loads(t)

# ---------------------------------------------------------------- 정답 비교
def norm_label(x): return re.sub(r"\s+", "", str(x or "")).lower()
def norm_str(x): return re.sub(r"\s+", "", str(x or "")).replace("×", "*").lower()

def num_eq(a, b, tol=0.051):
    if a is None or b is None: return a is None and b is None
    if isinstance(a, list) or isinstance(b, list):
        a2, b2 = (a if isinstance(a, list) else [a, a]), (b if isinstance(b, list) else [b, b])
        return len(a2) == len(b2) and all(num_eq(x, y, tol) for x, y in zip(a2, b2))
    try:
        return abs(float(a) - float(b)) <= tol
    except Exception:
        return False

REQUIRED = {"label", "heightCm", "weightKg", "fitHeightCm"}

def compare(gt, pred):
    items = []  # (name, required, correct)
    def add(name, ok, req=False): items.append((name, req, bool(ok)))
    gv, pv = gt["variants"], (pred or {}).get("variants") or []
    for i, g in enumerate(gv):
        p = pv[i] if i < len(pv) else {}
        if g.get("fitHeightCm") is not None:
            add(f"v{i}.fitHeightCm", num_eq(g["fitHeightCm"], p.get("fitHeightCm")), True)
        psizes = {norm_label(s.get("label")): s for s in (p.get("sizes") or [])}
        plist = p.get("sizes") or []
        for j, gs in enumerate(g["sizes"]):
            ps = psizes.get(norm_label(gs["label"]))
            add(f"v{i}.{gs['label']}.label", ps is not None, True)
            if ps is None:
                ps = plist[j] if j < len(plist) else {}
            for f in ["heightCm", "weightKg", "ageYears", "length", "shoulder"]:
                if gs.get(f) is not None:
                    add(f"v{i}.{gs['label']}.{f}", num_eq(gs[f], ps.get(f)), f in REQUIRED)
            for f, sub in [("chest", "basis"), ("waist", "basis"), ("hip", "basis"), ("sleeve", "from")]:
                if gs.get(f) is not None:
                    pf = ps.get(f) if isinstance(ps.get(f), dict) else {}
                    add(f"v{i}.{gs['label']}.{f}", num_eq(gs[f]["value"], pf.get("value")))
                    add(f"v{i}.{gs['label']}.{f}.{sub}", gs[f][sub] == pf.get(sub))
            pe = {norm_str(k): v for k, v in (ps.get("extra") or {}).items()}
            for k, v in (gs.get("extra") or {}).items():
                add(f"v{i}.{gs['label']}.extra.{k}", norm_str(v) == norm_str(pe.get(norm_str(k))))
    unit_ok = str(gt.get("weightUnit", "")).replace("추정_", "") == str((pred or {}).get("weightUnit", "")).replace("추정_", "")
    return items, unit_ok

def summarize(items):
    tot = len(items); ok = sum(c for _, _, c in items)
    req = [c for _, r, c in items if r]
    basis = [c for n, _, c in items if n.endswith(".basis") or n.endswith(".from")]
    return {"전체": f"{ok}/{tot}", "전체정확도": round(ok / tot, 3) if tot else None,
            "필수정확도": round(sum(req) / len(req), 3) if req else None,
            "기준(단면/둘레·화장)정확도": round(sum(basis) / len(basis), 3) if basis else None}

# ---------------------------------------------------------------- 실행
def run(args):
    labels = sorted(glob.glob(os.path.join(LABEL_DIRS[args.set], "*.json")))
    if args.only:
        labels = [l for l in labels if os.path.splitext(os.path.basename(l))[0] in args.only]
    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M") + f"_{args.set}"
    key = None if args.selftest else load_key()
    model = args.model
    cands = [model] if model else []
    if not args.selftest and not model:
        cands, allm = pick_model(key)
        model = cands[0]
        print("flash 계열 후보:", ", ".join(cands[:4]), "→", model, "부터 시도")
    report = {"model": model or "selftest", "set": args.set, "time": stamp, "items": {}}
    agg = {"first": [], "final": []}
    for lp in labels:
        gt_doc = json.load(open(lp, encoding="utf-8"))
        name = gt_doc["id"]; gt = gt_doc["spec"]
        imgs = [os.path.join(IMG_DIR, f) for f in gt_doc["sourceFiles"]]
        print(f"\n▶ {name}  ({', '.join(os.path.basename(i) for i in imgs)})")
        rec = {}
        if args.selftest:
            pred1 = copy.deepcopy(gt)
            if name == "top02":  # 일부러 틀린 값 넣어 보기
                pred1["variants"][0]["sizes"][0]["weightKg"] = [46, 60]
            text1, usage1 = json.dumps(pred1, ensure_ascii=False), {}
        else:
            t0 = time.time()
            text1 = None
            while text1 is None:
                try:
                    text1, usage1 = call_gemini(key, model, imgs)
                except RuntimeError as e:
                    print("  ", e)
                    if not report["items"] and len(cands) > 1 and not args.model:
                        cands.pop(0); model = cands[0]; report["model"] = model
                        print("   → 다른 모델로 전환:", model)
                        continue
                    report["items"][name] = {"error": str(e)}
                    break
            if text1 is None:
                json.dump(report, open(os.path.join(OUT_DIR, f"{stamp}_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
                continue
            rec["sec_first"] = round(time.time() - t0, 1)
        try:
            pred1 = parse(text1); errs = validate(pred1)
        except Exception as e:
            pred1 = None; errs = [f"JSON 파싱 실패: {e}"]
        items1, unit1 = compare(gt, pred1)
        rec.update({"first": summarize(items1), "unit_ok_first": unit1, "errors_first": errs})
        pred2, items2, unit2 = pred1, items1, unit1
        if errs and not args.selftest:
            fb = "이전 답변에서 다음 문제가 발견되었다. 이미지를 다시 확인해 고쳐서 전체 JSON을 다시 출력하라. 원본이 실제로 그렇다면 그대로 두어도 된다.\n- " + "\n- ".join(errs)
            time.sleep(args.sleep)
            t0 = time.time()
            try:
                text2, usage2 = call_gemini(key, model, imgs, extra_text=fb)
                rec["sec_retry"] = round(time.time() - t0, 1)
                try:
                    pred2 = parse(text2); errs2 = validate(pred2)
                except Exception as e:
                    pred2 = None; errs2 = [f"JSON 파싱 실패: {e}"]
                items2, unit2 = compare(gt, pred2)
                rec.update({"errors_retry": errs2})
            except RuntimeError as e:
                print("   재추출 실패:", e); rec["retry_failed"] = str(e)
            json.dump(pred2, open(os.path.join(OUT_DIR, f"{stamp}_{name}_retry.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        rec.update({"final": summarize(items2), "unit_ok_final": unit2,
                    "wrong_final": [n for n, _, c in items2 if not c][:40]})
        json.dump(pred1, open(os.path.join(OUT_DIR, f"{stamp}_{name}_first.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        report["items"][name] = rec
        agg["first"] += items1; agg["final"] += items2
        json.dump(report, open(os.path.join(OUT_DIR, f"{stamp}_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print("   1차:", rec["first"], "| 단위", "O" if unit1 else "X")
        if errs: print("   검증 오류:", errs[:3])
        print("   최종:", rec["final"])
        if not args.selftest: time.sleep(args.sleep)
    report["overall_first"] = summarize(agg["first"])
    report["overall_final"] = summarize(agg["final"])
    def macro(k):
        v = [r[k]["전체정확도"] for r in report["items"].values() if k in r and r[k]["전체정확도"] is not None]
        return round(sum(v) / len(v), 3) if v else None
    report["macro_first"], report["macro_final"] = macro("first"), macro("final")
    out = os.path.join(OUT_DIR, f"{stamp}_report.json")
    json.dump(report, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("\n=== 전체 ===")
    print("1차 (항목 합산):", report["overall_first"], "| 이미지 평균:", report["macro_first"])
    print("최종(항목 합산):", report["overall_final"], "| 이미지 평균:", report["macro_final"])
    print("결과 저장:", out)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--model")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--set", choices=["dev", "test"], default="dev", help="dev=라벨_초안(개발용 5장), test=라벨_테스트")
    ap.add_argument("--sleep", type=float, default=8.0, help="호출 간 대기(초), 무료 등급 분당 제한 대비")
    ap.add_argument("--selftest", action="store_true")
    run(ap.parse_args())
