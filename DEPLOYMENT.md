# 배포 가이드

## 1. GitHub 저장소 만들기

추천 저장소 이름:

`pharmacy-shopping-helper`

공개 저장소로 운영할 수 있지만, 초기 테스트 중에는 private 저장소가 더 안전합니다.

## 2. GitHub Pages로 계산기 배포

GitHub 저장소에 파일을 올린 뒤:

1. Repository `Settings`
2. `Pages`
3. Source를 `Deploy from a branch`로 선택
4. Branch는 `main`, folder는 `/root`
5. 배포 URL에서 `hmp-helper.html` 접속

예상 주소:

`https://사용자명.github.io/pharmacy-shopping-helper/hmp-helper.html`

## 3. 확장 프로그램 배포

초기 테스트:

1. 저장소에서 ZIP 다운로드
2. 압축 해제
3. Chrome 또는 Whale 확장 관리 페이지에서 `hmp-extension` 폴더 로드

공식 배포:

- Chrome Web Store 등록
- Whale 확장앱 등록

공식 배포 전에는 개인정보 처리방침 URL이 필요할 수 있으므로 `PRIVACY.md`를 GitHub Pages에서 공개 URL로 제공하는 방식을 권장합니다.

## 4. 버전 관리

확장 프로그램을 수정할 때마다 `hmp-extension/manifest.json`의 `version`을 올립니다.

예:

- `0.1.0`: 내부 테스트
- `0.2.0`: 약사 지인 테스트
- `1.0.0`: 공개 배포 후보

## 5. 안정화 체크

- 상품명 자동 인식
- 업체명 자동 인식
- 최저주문금액 반영
- 쿠폰 반영
- 장바구니 담기 성공/실패 로그
- 사용자가 직접 결제 확인하도록 안내
