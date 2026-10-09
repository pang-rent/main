# 팡팡렌트카 직접 예약

기존 홈페이지 디자인과 AI 상담을 유지하면서 직접 예약과 관리자 차량·요금 관리를 추가한 구현본입니다. 운영 배포 전에는 아래 안내와 DEPLOYMENT.md를 확인합니다. 가상 차량은 테스트 서버에서만 생성하며 실제 데이터베이스에 자동 등록하지 않습니다.

## 실행과 검사

Node.js 22와 npm을 사용합니다.

```sh
npm ci --prefix backend
npm test --prefix backend
node --test integrations/aiconsult/booking-catalog.test.js
node backend/preview-server.js
```

http://127.0.0.1:8878/ 는 가상 자료를 사용하는 홈페이지 확인본입니다. /booking.html, /admin-preview.html, /responsive-preview.html도 확인할 수 있습니다. 테스트 관리자 토큰은 이 로컬 서버만 인정하며 운영 서버에서는 Firebase 인증이 필요합니다. preview-server.js는 127.0.0.1에만 연결하고 운영 데이터베이스·AI 서비스에 연결하지 않습니다.

실제 RTDB 동시성·권한 검사는 Java 21과 Firebase CLI를 설치한 뒤 실행합니다.

```sh
firebase emulators:exec --only database --project demo-pang-booking --config firebase.emulators.json "node backend/test/emulator.cjs"
```

## 요금과 예약 기준

- 단기: 24시간 단위 올림. 각 대여일 시작 시점의 한국 날짜를 기준으로 기본·주말·성수기 중 높은 일요금을 적용합니다. 주말은 토·일, 성수기는 관리자 지정 기간입니다.
- 월: 최소 30일, 30일 월요금을 기준으로 올림된 대여일 수만큼 일할 계산합니다. 월요금에는 주말·성수기 할증을 적용하지 않습니다.
- 자차 보험: 선택 시 단기는 일 보험료, 월은 30일 보험료를 일할 계산합니다. 옵션은 예약 1회 또는 1일당 과금합니다. 별도 탁송비·추가 계약 비용은 포함하지 않습니다.
- 모든 금액은 원 단위 정수로 서버가 계산합니다. 화면에서 보낸 합계·가격 버전이 서버와 다르면 저장하지 않고 다시 확인하도록 합니다.
- 확인 대기·확정 예약 모두 동일 차량의 겹치는 시간을 차단합니다. 반납과 다음 대여 시각이 정확히 같으면 겹침으로 보지 않습니다. 준비 시간을 별도로 자동 추가하지 않습니다.
- 고객 신청은 확인 대기이며 계약 확정이 아닙니다. 관리자 확인·연락 후 확정 또는 취소합니다. 취소 예약을 다시 확정하지 않고 새 신청을 받습니다. 대기 예약은 관리자가 처리하기 전까지 시간을 확보하므로 정기적으로 목록을 확인해야 합니다.
- 차량마다 예시 요금 여부를 저장하고 홈페이지·AI·요금·예약 목록에 표시합니다. 실제 요금을 관리자가 입력한 뒤 예시 표시를 해제합니다.

## 변경 파일

| 파일 | 역할 |
|---|---|
| index.html, booking-home.js | 두 예약 진입 버튼, 공통 차량 라인업; 기존 소개·절차·연락처·AI 오버레이 유지 |
| chat.html | 서버 추천 차량을 직접 예약 화면으로 연결 |
| booking.html, booking.css, booking.js | 차량·날짜·보험·옵션·요금·고객 동의·예약 접수 |
| booking-config.js | 공개 업체 ID와 API 주소; 비밀키 없음 |
| booking-admin.js, booking-admin.css | 기존 로그인 세션을 사용하는 예약 목록·날짜 조회·확정/취소·차량 관리 |
| backend/domain.js, service.js, store.js | 검증, 요금 계산, 원자적 예약 저장, 버전 충돌 방지 |
| backend/http.js, admin-auth.js, index.js | HTTP API, 서버 관리자 검사, App Check, 요청 제한, 90일 개인정보 정리 |
| integrations/admin-board.patch | 비공개 현황판의 기존 상단 메뉴에 관리자 전용 예약 관리 추가 |
| integrations/aiconsult.patch, integrations/aiconsult/ | 기존 AI 서버에 공통 차량 자료·추천 링크 연동; 기존 상담 신청·푸시·신차 계산 유지 |
| scripts/apply-integrations.cjs | 기존 비공개 소스에 최소 변경 적용; 배포하지 않음 |
| scripts/merge-database-rules.cjs | 기존 규칙을 유지하면서 예약 비공개 경로만 추가; 배포하지 않음 |
| firebase.booking.json | 예약 Functions 전용 배포 설정; DB 규칙 배포 없음 |
| firebase.emulators.json, backend/database.rules.json | 테스트 전용 DB 규칙·에뮬레이터 설정 |
| backend/test/, .github/workflows/booking-checks.yml | 서버·UI·권한·회귀·실제 RTDB 트랜잭션 검사; APK 빌드 없음 |

## 보안과 운영 범위

차량 자료와 예약 개인정보는 서버 전용 rentalBookingPrivate, 사진은 rentalBookingPhotos에 저장합니다. 직접 DB 읽기·쓰기는 관리자도 허용하지 않고 검증된 API를 통해 처리합니다. 공개 목록은 차량 이름·차급·사진·요금·옵션만 반환하며 고객·내부 담당자 정보는 제외합니다.

관리자 API는 현재 업체 owner 역할과 Firebase ID 토큰을 서버에서 검증합니다. 브라우저 버튼 숨김은 권한 검사의 대체가 아닙니다. 같은 프로젝트의 다른 업체 관리자도 다른 업체 예약을 볼 수 없습니다. 기존 데이터베이스 관리자 전체 권한은 변경하지 않으며 일반 고객·직원의 접근을 막는 구조입니다.

신청 API는 App Check가 필수입니다. 공개 웹 Firebase 설정·reCAPTCHA 사이트 키는 비밀이 아니지만, 서비스 계정 파일·AI API 키·로그인 토큰은 프론트엔드나 Git에 넣지 않습니다. IP 기반 분당 요청 제한과 최대 인스턴스 제한도 적용합니다. App Check는 인증·자동화 남용 방어의 한 요소이며 모든 스팸을 완전히 막는 장치는 아닙니다.

고객 정보는 대여 종료 또는 취소 후 90일이 지난 뒤 정기 작업에서 비식별 처리합니다. 실계약의 법정 보존 자료는 이 간단한 신청 DB와 분리해 운영합니다. 운영자의 개인정보 처리 안내·보관 기준 확인 후 공개합니다.

현재는 업체당 최대 200대·예약 10,000건으로 제한합니다. 기존 예약 이력이 많아지면 보관 종료 예약을 별도 비식별 보관소로 옮기는 확장이 필요합니다. 카드 결제·문자 자동 발송·외부 운영 현황과 실시간 예약 재고 동기화는 이번 구현에 포함되지 않습니다. 실제 배차를 별도로 처리하면 공개 예약 차량의 불가 상태도 관리해야 합니다.

검증 결과는 TEST_REPORT.md, 구조 분석은 ANALYSIS.md, 배포·복구 순서는 DEPLOYMENT.md에 있습니다.
