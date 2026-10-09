# 배포 절차와 복구

2026-10-09 사용자 승인 후 예약 API·개인정보 정리 작업, 운영 App Check 설정, 관리자 현황판과 AI 상담 연동을 배포했다. 공개 홈페이지 PR #2를 main에 병합했고 기존 GitHub Pages 게시도 성공했다. 실제 차량·요금은 임의 등록하지 않았으며 관리자가 등록해야 온라인 선택 목록에 표시된다.

## 1. 기존 환경 백업과 비공개 소스 적용

- 홈페이지 기존 커밋 3ea9c3c와 현재 Pages 설정을 기록한다.
- 비공개 현황판 source의 최신 커밋·현재 AI 서비스 리비전·DB 규칙을 백업한다. 패치 기준은 source 5e2870c다. 다른 변경이 들어왔으면 패치 충돌을 해결하고 기존 내용을 보존한다.
- 비공개 소스의 별도 작업 브랜치에서 다음을 실행한다. 경로는 실제 checkout으로 바꾼다.

```sh
node scripts/apply-integrations.cjs /path/to/status-board-source
```

이 명령은 공개 저장소의 루트에서 실행한다. 기존 index.html의 상담·메신저·차량 기능은 유지하고 예약 관리 메뉴 및 전용 스크립트만 추가한다. AI 서버는 공통 차량 추천 기능만 추가한다. 실제 비공개 소스 전체를 공개 홈페이지 저장소에 복사하지 않는다.

적용 후 비공개 source에서 기존 AI 의존성을 설치하고 회귀 검사를 실행한다.

```sh
npm ci --prefix server/aiconsult
node --test server/aiconsult/booking-catalog.test.js server/aiconsult/booking-regression.test.js
```

## 2. 기존 데이터베이스 규칙에 비공개 경로 병합

Firebase 콘솔에서 현재 운영 RTDB 규칙을 내려받아 기존 파일과 별도로 보관한다. JSON으로 변환할 때 기존 표현식과 모든 경로를 보존한다.

```sh
node scripts/merge-database-rules.cjs current-rules.json merged-rules.json
```

차이를 검토해 rentalBookingPrivate, rentalBookingPhotos, rentalBookingRate만 추가됐는지 확인한다. 이 경로의 클라이언트 read/write는 모두 false이고 요청 제한 만료 정리용 expiresAt 인덱스만 추가한다. 기존 companies·members·history·map·docs 규칙을 삭제하거나 바꾸지 않는다. 루트 읽기/쓰기가 이미 열려 있거나 루트 와일드카드가 있으면 이 스크립트는 중단한다. 상위 허용은 하위 false로 취소되지 않으므로 먼저 별도 검토가 필요하다.

검토한 merged-rules.json을 기존 운영 규칙 배포 방식으로 적용한다. **backend/database.rules.json은 테스트 전용 전체 거부 규칙이므로 운영에 배포하지 않는다.** firebase.booking.json은 DB 규칙 설정을 포함하지 않아 Functions 배포가 기존 규칙을 덮어쓰지 않는다.

## 3. App Check와 예약 API

기존 Firebase 프로젝트 fleet-board-f2345의 웹 앱에 App Check reCAPTCHA Enterprise 제공자를 등록한다. Cloud 프로젝트의 점수형 웹 키를 사용하고 사이트 키의 허용 도메인에 pang-rent.github.io를 등록한다. 현재 프론트엔드는 ReCaptchaEnterpriseProvider를 사용하므로 Firebase의 recaptchaEnterpriseConfig.siteKey와 같은 키여야 한다. 위험 점수 하한은 권장 기본값 0.5를 유지한다. 정상적인 Pages 페이지에서 토큰 발급을 확인한다. 실제 테스트를 위해 보안 검사를 끄거나 운영에 디버그 토큰을 넣지 않는다.

backend/.env.fleet-board-f2345를 로컬에 만든다. Git에 포함하지 않는다. 다음 값은 프로젝트의 실제 공개 웹 설정과 reCAPTCHA 사이트 키로 대체한다. 서비스 계정 비밀키와 AI 키는 여기에 추가하거나 프론트엔드로 전달하지 않는다.

```dotenv
BOOKING_COMPANIES=c_jangsung01
BOOKING_PUBLIC_CONFIG='{"firebase":{"apiKey":"PUBLIC_WEB_API_KEY","authDomain":"fleet-board-f2345.firebaseapp.com","projectId":"fleet-board-f2345","appId":"PUBLIC_WEB_APP_ID"},"recaptchaSiteKey":"PUBLIC_RECAPTCHA_SITE_KEY"}'
```

Node.js 22로 검사한 뒤 새 Functions codebase만 배포한다.

```sh
npm ci --prefix backend
npm test --prefix backend
firebase deploy --project fleet-board-f2345 --config firebase.booking.json --only functions:rental-booking
```

배포되는 기능은 rentalBookingApi와 rentalBookingPrivacyCleanup 두 개다. 기존 sendchatpush·aiconsult·다른 Functions는 이 config의 관리 대상이 아니다. 실제 배포 결과의 API URL을 booking-config.js에 반영한다. 현재 기본값은 asia-northeast3-fleet-board-f2345.cloudfunctions.net/rentalBookingApi다.

App Check 구성이 없으면 요금 조회는 가능하지만 고객 신청 버튼은 비활성화된다. 서버도 유효한 App Check 토큰 없는 신청은 403으로 거절한다. 일반 직원·타 업체 관리자·취소된 ID 토큰의 관리자 API 접근도 401/403이어야 한다.

Functions·Cloud Run·RTDB·정기 실행은 사용량에 따라 요금이 발생할 수 있다. 기존 결제 프로젝트의 예산 알림을 설정하고 작은 범위의 테스트로 확인한다. API 최대 인스턴스 3개, 업체당 차량 200대·예약 10,000건, IP당 분당 공개 30건·관리자 100건 제한이 있다. 테스트 에뮬레이터는 운영 데이터베이스를 사용하지 않는다.

## 4. 관리자 웹과 실제 차량 등록

비공개 현황판 Hosting 배포 묶음에 수정된 index.html과 booking-admin.js, booking-admin.css, booking-config.js를 포함한다. 기존 APK 다운로드·지도·문서·다른 웹 파일은 기존 정상 배포 묶음에서 유지한다. 홈페이지 파일만으로 현황판 Hosting 전체를 덮어쓰지 않는다.

기존 계정으로 관리자 현황판에 로그인하면 상담 옆의 ‘예약·차량 관리’가 표시된다. 서버 현재 업체 역할이 owner인 계정만 예약·차량 자료를 처리할 수 있다. 일반 직원은 메뉴가 숨겨지고 API도 거절된다.

‘차량·요금 관리’에서 실제 예약 가능한 차량을 한 대씩 등록한다. 차량 공개 이름·사진·일일·월·보험·주말·성수기 요금과 옵션을 설정한다. 확인된 실제 요금만 예시 표시를 해제한다. 사진에 고객·번호판·내부 정보가 포함되지 않게 한다. 기존 차량 현황판 자료는 자동 공개하지 않는다.

확인 대기 예약도 시간을 확보한다. 취소·확정 절차를 담당자 운영 방식에 포함하고, 이미 외부에서 배차한 차량은 불가 상태로 바꾼다. 개인정보 안내·보관 기간을 운영 기준에 맞게 확인한다.

## 5. 기존 AI 서비스 업데이트

기존 aiconsult 함수의 배포 방식·서비스 계정·FIREBASE_CONFIG를 유지하고 패치된 server/aiconsult 소스를 새 리비전으로 올린다. Cloud Run 함수의 source 배포 방식인 경우 명령 예시는 다음과 같다. 현재 서비스가 Cloud Functions v2로 관리되면 기존 functions 배포 명령을 그대로 사용하며 관리 방식을 임의로 변경하지 않는다.

```sh
gcloud run deploy aiconsult --project fleet-board-f2345 --region asia-northeast3 --source /path/to/status-board-source/server/aiconsult --function aiconsult --base-image nodejs24
```

기존 공개 호출 권한·서비스 환경변수·AI 키 저장 경로를 유지한다. 새 차량 자료를 읽을 서버 서비스 계정의 현재 DB 권한을 확인한다. AI 키는 기존 서버 aiSettings에서 읽으며 홈페이지에 넣지 않는다.

추천 응답은 등록 자료의 차량 ID만 반환한다. 예시 요금 표기, 등록 자료가 없을 때 담당자 문의, 기존 상담 신청 저장·채팅·푸시, 신차 금융 견적을 확인한다. 정확한 날짜별 요금·가능 여부와 최종 저장은 예약 API가 담당한다.

## 6. 홈페이지 배포와 최종 검사

예약 API·관리자·AI 검증 후 pang-rent/main의 검토된 변경 브랜치를 main에 병합해 기존 GitHub Pages 방식으로 게시한다. 고객 개인정보·관리자 인증 자료·.env·node_modules는 공개하지 않는다. Node 백엔드는 GitHub Pages에서 실행하지 않는다.

실제 Pages에서 두 진입 버튼, AI 추천 연결, 단기·월 요금, 보험·옵션·주말·성수기, 신청 확인 대기, 같은 날짜 두 동시 신청, 관리자 확정·취소, 일반 직원 차단을 확인한다. 모바일 Safari/Chrome의 실제 키보드·날짜 입력·사진 선택·App Check는 실제 기기에서 추가 확인한다. 출시 전 테스트 예약은 관리자가 취소한다.

## 복구

문제가 있으면 먼저 홈페이지를 기존 커밋으로 되돌리고 새 접수 진입점을 숨긴다. 관리자 페이지 추가 스크립트·메뉴를 이전 리비전으로 되돌리고 AI는 이전 Cloud Run/Functions 리비전으로 복구한다. 새 예약 개인정보 경로의 거부 규칙은 유지한다. 이미 접수된 예약을 DB에서 삭제하지 말고 담당자가 연락·취소 처리한다. 다른 기존 현황판 기능·APK·자료를 함께 되돌리지 않는다.

공식 참고: [RTDB 트랜잭션](https://firebase.google.com/docs/database/admin/save-data), [웹 App Check](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider), [Firebase 환경변수](https://firebase.google.com/docs/functions/config-env), [Cloud Run 함수 배포](https://docs.cloud.google.com/run/docs/deploy-functions).
