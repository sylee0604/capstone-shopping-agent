# 발표 슬라이드용 그림 생성: python 발표자료/그림/_만들기.py  (playwright 필요)
# HTML로 그림을 그려 PNG(폭 1600px, 2배 해상도)로 저장한다. 글자는 검정, 도형만 색을 쓴다.
import asyncio, base64, pathlib, shutil
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(__file__).resolve().parent

def img64(rel):
    p = ROOT / rel
    return f"data:image/webp;base64,{base64.b64encode(p.read_bytes()).decode()}"

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Noto Sans CJK KR','Malgun Gothic',sans-serif;color:#111;background:#fff;word-break:keep-all}
.fig{width:1600px;padding:48px 56px;background:#fff}
h1{font-size:40px;font-weight:700;margin-bottom:28px}
.sub{font-size:24px;color:#333;margin:-16px 0 28px}
.row{display:flex;gap:28px;align-items:stretch}
.box{border:2.5px solid #94A3B8;border-radius:16px;padding:24px 26px;background:#F8FAFC;font-size:26px;line-height:1.5}
.b-llm{background:#EDE9FE;border-color:#7C3AED}.b-code{background:#DBEAFE;border-color:#2563EB}
.b-web{background:#D1FAE5;border-color:#059669}.b-user{background:#FFEDD5;border-color:#EA580C}
.b-gray{background:#F1F5F9;border-color:#64748B}
.t{font-weight:700;font-size:30px;margin-bottom:8px}
.arrow{display:flex;align-items:center;font-size:56px;color:#334155;font-weight:700}
table{border-collapse:collapse;width:100%;font-size:25px;line-height:1.45}
th,td{border:2px solid #CBD5E1;padding:14px 18px;text-align:left;vertical-align:top}
th{background:#F1F5F9;font-weight:700}
.big{font-size:84px;font-weight:800;line-height:1}
.unit{font-size:30px;font-weight:700}
.note{font-size:22px;color:#333;margin-top:18px}
.pill{display:inline-block;width:240px;text-align:center;flex:none;border-radius:999px;padding:4px 16px;font-size:22px;font-weight:700;border:2px solid}
"""

FIGS = {}

FIGS['02_사이즈표가_어려운_이유'] = f"""
<h1>중국 쇼핑몰 사이즈표, 왜 읽기 어려운가</h1>
<div class="row">
 <div class="box" style="flex:1;padding:16px"><img src="{img64('사이즈표/top/O1CN01FG6FCkjUWeD1WPiF_!!908948999.webp')}" style="width:100%;height:520px;object-fit:contain;background:#fff">
  <div class="t" style="margin-top:12px">① 호형 표기</div>175/96A = 키 175cm, 가슴둘레 96cm 체형용</div>
 <div class="box" style="flex:1;padding:16px"><img src="{img64('사이즈표/top/O1CN01YgLl1o1i6IuaEWnQa_!!2216119884363.webp')}" style="width:100%;height:520px;object-fit:contain;background:#fff">
  <div class="t" style="margin-top:12px">② 몸무게가 斤(근) 단위</div>1斤 = 0.5kg → 120斤 = 60kg</div>
 <div class="box" style="flex:1;padding:16px"><img src="{img64('사이즈표/top/O1CN01lMSRMk1gdckTpL3zN_!!2578794165.webp')}" style="width:100%;height:520px;object-fit:contain;background:#fff">
  <div class="t" style="margin-top:12px">③ 권장 키·몸무게 없음</div>옷 치수만 있어 내 몸에 맞는지 알기 어려움</div>
</div>
<div class="note">모두 글자가 아닌 이미지라 번역기로 바로 읽을 수 없음 · 가슴 '단면'(한쪽 폭)과 '둘레'가 섞여 값이 2배까지 차이남</div>
"""

FIGS['03_목표'] = """
<h1>한국어 요청 한 줄 → 맞는 사이즈와 근거</h1>
<div class="row">
 <div class="box b-user" style="flex:1.1"><div class="t">사용자 요청</div>"남자 와이셔츠"<br>"여아 원피스 키 120 3만원 이하"<div class="note">키·몸무게는 '내 정보'에 저장해 두면 생략 가능</div></div>
 <div class="arrow">→</div>
 <div class="box b-code" style="flex:1.1"><div class="t">에이전트</div>검색 → 후보 3개 제시<br>→ 사이즈 정보 읽기<br>→ 적합도 판정</div>
 <div class="arrow">→</div>
 <div class="box b-web" style="flex:1.3"><div class="t">추천 결과</div><b>180/100A · 적합</b><br>키 179cm → 가장 가까운 큰 사이즈<br>재고 있음</div>
</div>
<div class="row" style="margin-top:28px">
 <div class="box b-gray" style="flex:1"><div class="t">범위</div>의류 · 타오바오·티몰·1688<br>(통관·관세 안내, 결제는 제외)</div>
 <div class="box b-gray" style="flex:1"><div class="t">목표 (계획서)</div>사이즈표 추출: 필수 항목 80% 이상, 전체 항목 70% 이상<br>에이전트 작업 시간 90초 이내</div>
</div>
"""

FIGS['04_시연흐름'] = """
<h1>시연: "남자 와이셔츠" (키 179cm · 75kg, 티몰)</h1>
<div class="row" style="gap:16px">
 <div class="box b-user" style="flex:1"><div class="t">① 요청</div>사이드패널에 "남자 와이셔츠" 입력</div>
 <div class="arrow" style="font-size:40px">→</div>
 <div class="box b-web" style="flex:1"><div class="t">② 검색</div>중국어로 바꿔 검색, 후보 3개 제시 → 1개 선택</div>
 <div class="arrow" style="font-size:40px">→</div>
 <div class="box b-llm" style="flex:1"><div class="t">③ 사이즈표 읽기</div>170/88A, 175/92A, 175/96A …</div>
 <div class="arrow" style="font-size:40px">→</div>
 <div class="box b-code" style="flex:1"><div class="t">④ 판정</div>179에 맞는 칸 없음 → 키 이상인 가장 가까운 사이즈 (180은 옵션에서 찾음)</div>
 <div class="arrow" style="font-size:40px">→</div>
 <div class="box b-web" style="flex:1"><div class="t">⑤ 결과</div><b>180/100A 적합</b><br>재고 있음<br>54.2초</div>
</div>
"""

FIGS['04_실행사례'] = """
<h1>실제 상품으로 실행한 사례</h1>
<table>
<tr><th style="width:24%">요청 (쇼핑몰)</th><th style="width:26%">상황</th><th style="width:30%">에이전트 동작</th><th>결과</th></tr>
<tr><td>남자 와이셔츠, 키 179 75kg (티몰)</td><td>표에 키 179에 맞는 칸이 없음</td><td>키 이상인 가장 가까운 사이즈를 고르고, 표에 없는 사이즈는 옵션에서 찾아 보탬</td><td><b>180/100A 적합</b>, 54.2초</td></tr>
<tr><td>남자 패딩, 키 179 (티몰)</td><td>상품을 읽는 중 무료 LLM 사용량 한도 초과</td><td>실행을 멈추지 않고 남은 후보에서 다시 고르게 함</td><td>실행 유지</td></tr>
<tr><td>여아 원피스 110 사이즈 (타오바오)</td><td>"110"을 키로 잘못 읽는 문제 발견</td><td>"110 사이즈"는 아동복 사이즈로 인식하도록 수정</td><td>표의 110 추천</td></tr>
</table>
"""

FIGS['05_시스템구조'] = """
<h1>시스템 구조: 사용자 브라우저(Chrome 확장) 안에서 동작</h1>
<div class="row" style="align-items:center">
 <div style="flex:3.2;border:3px dashed #64748B;border-radius:20px;padding:26px">
  <div style="font-size:26px;font-weight:700;margin-bottom:18px">Chrome 확장 프로그램</div>
  <div class="row">
   <div class="box b-user" style="flex:1"><div class="t">사이드패널 화면</div>요청 입력, 후보 선택,<br>결과·근거 표시</div>
   <div class="arrow">⇄</div>
   <div class="box b-code" style="flex:1.1"><div class="t">에이전트 실행 그래프</div>14단계 순서·분기 관리<br>단계마다 상태 저장</div>
  </div>
  <div class="row" style="margin-top:22px">
   <div class="box b-web" style="flex:1"><div class="t">브라우저 조작</div>로그인된 쇼핑몰 탭에서<br>검색 결과·상세 페이지 읽기</div>
   <div class="box b-llm" style="flex:1"><div class="t">LLM 호출 계층</div>사이즈표 읽기 요청,<br>답변 양식(스키마) 검사</div>
  </div>
 </div>
 <div style="flex:1;display:flex;flex-direction:column;gap:40px">
  <div class="box b-gray"><div class="t">타오바오·티몰</div>← 브라우저 조작</div>
  <div class="box b-gray"><div class="t">Gemini API</div>← LLM 호출 (유일한 외부 호출)</div>
 </div>
</div>
<div class="note">별도 서버 없음 → 쇼핑몰 로그인을 그대로 사용, 서버 비용 없음</div>
"""

FIGS['07_사이즈표분석'] = """
<h1>사이즈표 25장 분석 결과</h1>
<div class="sub">타오바오·티몰 판매량 상위 상품 · 상의 10장, 하의 10장, 원피스 5장</div>
<table>
<tr><th style="width:44%">발견한 특징</th><th style="width:14%">장 수</th><th>대응 (스키마 v1.2)</th></tr>
<tr><td>몸무게가 斤(0.5kg) 단위</td><td><b>11장</b></td><td>단위를 기록하고 kg으로 바꿔 비교</td></tr>
<tr><td>가슴·허리 등을 단면(한쪽 폭)으로 표기</td><td><b>10장</b></td><td>치수마다 단면/둘레를 기록</td></tr>
<tr><td>권장 키·몸무게 없이 옷 치수만 있음</td><td><b>8장</b> (약 1/3)</td><td>판정 시 '경계'로 두고 실측 비교 안내</td></tr>
<tr><td>길이별로 표가 여러 개</td><td><b>4장</b></td><td>표 여러 개를 담는 칸 추가</td></tr>
<tr><td>키×몸무게 매트릭스 표</td><td><b>1장</b></td><td>매트릭스 칸 추가</td></tr>
</table>
<div class="note">사람이 직접 만든 정답 라벨 25장 (개발용 5장 + 테스트용 20장) → 정확도 측정에 사용</div>
"""

FIGS['08_사이즈정보_찾는순서'] = """
<h1>사이즈 정보는 쉬운 곳부터 찾는다</h1>
<div style="display:flex;flex-direction:column;gap:18px">
 <div class="row" style="align-items:center"><div class="box b-web" style="flex:1;margin-left:0"><div class="t">1. 상품 옵션 이름</div>'175/84A', '建议身高110-120'(권장 키), '推荐135~142斤'(권장 몸무게)이 적혀 있으면 바로 판정</div><span class="pill" style="border-color:#059669">LLM 0회</span></div>
 <div class="row" style="align-items:center"><div class="box b-web" style="flex:1;margin-left:90px"><div class="t">2. 페이지의 사이즈표 (글자 표)</div>'尺码表'(사이즈표) 버튼을 눌러 표를 글자로 읽음</div><span class="pill" style="border-color:#7C3AED">LLM 1회 (글자만)</span></div>
 <div class="row" style="align-items:center"><div class="box b-llm" style="flex:1;margin-left:180px"><div class="t">3. 상세 설명 이미지</div>최대 12장을 코드로 검사 → 표처럼 보이는 이미지만 최대 3장 보냄</div><span class="pill" style="border-color:#7C3AED">LLM 1회</span></div>
 <div class="row" style="align-items:center"><div class="box b-gray" style="flex:1;margin-left:270px"><div class="t">4. 어디에도 없음</div>옵션이 S/M/L뿐이고 표 이미지도 없음 → '사이즈표 없음' 알리고 다른 후보 선택</div><span class="pill" style="border-color:#059669">LLM 0회</span></div>
</div>
<div class="note">표처럼 보이는지 판별: 흰 배경 비율·글자 밀도·격자선을 계산 (LLM 없이) → 사이즈표 25장 중 23장을 '표'로 판별</div>
"""

FIGS['09_판정규칙'] = """
<h1>적합도 판정: 사이즈 결정은 LLM이 아니라 정해진 규칙(코드)</h1>
<table>
<tr><th style="width:24%">사이즈표 종류</th><th style="width:48%">판정 방법</th><th>예</th></tr>
<tr><td>권장 키·몸무게 범위</td><td>둘 다 범위 안 → <b>적합</b><br>하나만 맞거나 범위 끝에서 조금 벗어남(키 3cm·몸무게 2kg 이내) → <b>경계</b><br>그 외 → <b>부적합</b></td><td>키 120·21kg → 120 (권장 116~125cm, 19~24kg) 적합</td></tr>
<tr><td>호형 표기 (175/96A)</td><td>내 키 이상인 가장 가까운 사이즈</td><td>키 179 → 180/100A</td></tr>
<tr><td>키×몸무게 매트릭스</td><td>표 범위 안일 때만 해당 칸 사용</td><td>키 168·60kg → M</td></tr>
<tr><td>아동복 숫자 사이즈 (110, 120 …)</td><td>숫자를 키 기준으로 보고 키 이상인 가장 작은 사이즈<br>"110 사이즈"라고 말하면 그 사이즈 우선</td><td>키 118 → 120</td></tr>
<tr><td>권장 키 없는 성인 표</td><td><b>경계</b>로 두고 실측 치수를 평소 옷과 비교하도록 안내</td><td></td></tr>
</table>
<div class="note">공통: 맞는 사이즈가 품절이면 부적합(품절) · 斤은 kg으로 바꿔 비교 · 같은 입력이면 항상 같은 결과, 근거 설명 가능</div>
"""

FIGS['10_API절약'] = """
<h1>LLM은 꼭 필요한 곳(사이즈표 읽기)에만</h1>
<table>
<tr><th style="width:17%">단계</th><th style="width:30%">처음</th><th style="width:36%">바꾼 방식</th><th>효과</th></tr>
<tr><td>요청 분석</td><td>요청 문장을 LLM에 보내 품목·키 등을 뽑음</td><td>용어 사전(100개)과 규칙으로 코드가 직접 뽑음 (사전에 없는 품목만 LLM)</td><td><b>37초 → 0.2초</b></td></tr>
<tr><td>사이즈표 찾기</td><td>상세 이미지 여러 장을 한꺼번에 LLM에 보냄</td><td>옵션 → 페이지 표 → 표처럼 보이는 이미지(최대 3장) 순서</td><td>옵션에 정보가 있으면 LLM 0회</td></tr>
<tr><td>상세 페이지 읽기</td><td>이미지를 다 불러오려고 페이지 끝까지 스크롤</td><td>옵션을 먼저 읽고, 사이즈표를 찾으면 스크롤 멈춤</td><td>아래 와이셔츠 예</td></tr>
<tr><td>근거 문장</td><td>LLM이 작성하도록 설계</td><td>판정 결과를 정해진 문장 틀에 채움</td><td>LLM 0회</td></tr>
</table>
<div class="row" style="margin-top:30px">
 <div class="box b-gray" style="flex:1;text-align:center"><div style="font-size:26px;margin-bottom:10px">요청 분석 시간</div><span class="big">37</span><span class="unit">초</span> <span class="big" style="color:#334155">→</span> <span class="big">0.2</span><span class="unit">초</span></div>
 <div class="box b-gray" style="flex:1;text-align:center"><div style="font-size:26px;margin-bottom:10px">와이셔츠 전체 작업 시간 (같은 요청·같은 상품)</div><span class="big">85.3</span><span class="unit">초</span> <span class="big" style="color:#334155">→</span> <span class="big">54.2</span><span class="unit">초</span></div>
</div>
<div class="note">상품 1개 분석에 쓰는 LLM 호출: 0~1회 (읽은 표가 이상하면 1회 더)</div>
"""

FIGS['11_실패대응'] = """
<h1>문제가 생겨도 멈추지 않고 스스로 고친다</h1>
<table>
<tr><th style="width:34%">상황</th><th>에이전트의 대응</th></tr>
<tr><td>검색 결과가 없음</td><td>더 일반적인 검색어 → LLM이 만든 새 검색어로 재검색 (최대 2회)</td></tr>
<tr style="background:#FEF2F2"><td><b>읽어 온 사이즈표가 이상함</b></td><td><b>코드가 검사 → 문제를 LLM에 알려 1회 다시 읽게 함 (자기수정)</b></td></tr>
<tr><td>맞는 사이즈가 없거나 품절</td><td>이유를 보여주고 남은 후보에서 다시 선택, 후보를 다 보면 새로 검색 (1회)</td></tr>
<tr><td>LLM 서버 혼잡(503)·사용량 한도(429)</td><td>그 상품만 건너뛰고 남은 후보 선택</td></tr>
<tr><td>로그인·보안 확인 화면</td><td>멈췄다가 로그인하면 이어서 실행</td></tr>
<tr><td>패널을 닫거나 오류로 중단</td><td>단계마다 저장한 상태에서 이어서 실행</td></tr>
</table>
<div class="note">자기수정 검사 4가지: 같은 사이즈 이름 중복 · 사이즈가 커지는데 치수가 줄어듦 · 키와 몸무게 조합이 비현실적(斤/kg 혼동) · 가슴둘레가 키에 비해 너무 작음(단면/둘레 혼동)</div>
"""

FIGS['12_정확도와테스트'] = """
<h1>사이즈표 추출 정확도와 자동 테스트</h1>
<div class="sub">정답을 미리 만든 사이즈표 20장(처음 보는 표, 항목 1,129개)을 LLM(gemini-3.8-flash)으로 읽혀 정답과 비교</div>
<div class="row">
 <div class="box b-gray" style="flex:1;text-align:center"><div style="font-size:26px">필수 항목</div><div style="font-size:21px;color:#333">사이즈 이름·권장 키·몸무게</div><div class="big" style="margin:14px 0">100%</div><div style="font-size:24px">279/279 · 목표 80%</div></div>
 <div class="box b-gray" style="flex:1;text-align:center"><div style="font-size:26px">전체 항목</div><div style="font-size:21px;color:#333">치수·단위·측정 기준 등 모든 칸</div><div class="big" style="margin:14px 0">98.4%</div><div style="font-size:24px">1,111/1,129 · 목표 70%</div></div>
 <div class="box b-gray" style="flex:1.15"><div class="t">자동 테스트 58개 모두 통과</div>흐름 13 · 저장·복원 2<br>LLM 호출 7 · 검색 12<br>분석·판정 24</div>
</div>
<div class="note">틀린 18개는 모두 측정 기준(단면/둘레, 소매 시작점) 표시이고 숫자는 모두 맞음 · 사람이 고른 사이즈표 이미지 기준</div>
"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1600, 'height': 900}, device_scale_factor=2)
        for name, body in FIGS.items():
            await pg.set_content(f"<html><head><meta charset='utf-8'><style>{CSS}</style></head><body><div class='fig' id='f'>{body}</div></body></html>")
            await pg.wait_for_timeout(150)
            await (await pg.query_selector('#f')).screenshot(path=str(OUT / f'{name}.png'))
            print('저장', name)
        await b.close()
    shutil.copy(ROOT / '에이전트/에이전트_그래프.png', OUT / '06_에이전트그래프.png')
    shutil.copy(ROOT / '발표자료/캡처/20261116_패딩_LLM실패처리.png', OUT / '11_실패처리캡처.png')

asyncio.run(main())
