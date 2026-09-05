# Lotto-645

동행복권 공개 데이터를 바탕으로 전체 회차의 로또 6/45 1·2등 당첨판매점을 지도에 표시합니다.

- 기본 화면은 **전체 회차**이며, 회차·등수·판매점/주소로 필터링할 수 있습니다.
- 같은 판매점의 당첨 기록은 하나의 마커에 누적됩니다. 팝업의 **이전 당첨 기록 더 보기**로 오래된 기록도 확인할 수 있습니다.
- 판매점 공식 조회가 제공되는 **262회부터** 수집합니다. 1–261회 판매점은 공식 데이터가 없어 포함하지 않습니다.
- 인터넷 판매점과 유효한 좌표가 없는 기록은 제외하며, 판매점 위치·주소는 가장 최근 공개 정보 기준입니다.

## 실행 및 검증

Node.js 22.13 이상과 pnpm을 사용합니다.

```powershell
cd site
pnpm install --frozen-lockfile
pnpm dev
```

지도는 `site/public/data/lotto-map-data.json`의 전체 회차 데이터를 사용합니다. 파일이 없거나 최신 공식 회차까지 갱신하려면 다음을 실행하고, 생성한 JSON 파일도 배포에 함께 포함해야 합니다.

```powershell
pnpm data:build
pnpm data:validate
pnpm test
pnpm lint
pnpm build
```

수집기는 모든 회차의 당첨번호·당첨금과 판매점 기록을 받아 판매점 ID로 병합합니다. 중단된 판매점 수집은 `.lotto-build-checkpoint.ndjson`에서 이어서 진행하며, 완료된 회차 결과도 `.lotto-draws-checkpoint.json`에 임시 보관합니다. 검증을 통과한 파일만 기존 데이터를 교체합니다. 기본 요청 간격은 1초이고 재시도를 지원합니다.

`pnpm build`는 전체 회차 데이터 검증을 먼저 실행하고, 빌드 후에도 `/data/lotto-map-data.json`에 해당하는 배포 파일이 원본과 동일한지 확인합니다. 회차가 빠졌거나 최근 회차 샘플만 들어 있거나 데이터 파일이 배포에서 누락되면 빌드를 중단합니다. 브라우저에서도 같은 데이터 검증을 적용하며, 로딩 실패 시 오류와 재시도 버튼을 표시합니다.

## Vercel 배포

GitHub 저장소를 연결하면 `vercel.json`이 설치·빌드 명령과 출력 폴더를 지정합니다. Vercel 프로젝트의 Root Directory가 저장소 루트이거나 `site`인 경우 모두 지원합니다. Node.js는 22.13 이상을 사용해야 합니다.

Vercel에서는 `pnpm build:vercel`로 첫 화면을 정적 HTML로 생성하고 `dist/client`를 배포합니다. 빌드는 전체 회차 JSON뿐 아니라 `index.html`과 연결된 JavaScript·CSS 파일의 존재도 검사합니다. Cloudflare용 서버 결과만 배포하여 첫 화면에 404가 발생하는 것을 방지합니다.

```powershell
cd site
pnpm build:vercel
```

Sites 배포는 기존 `pnpm build`와 Cloudflare 설정을 사용합니다.

요청 간격을 늘려 재개하려면 PowerShell에서 다음과 같이 실행할 수 있습니다. 기존 체크포인트를 삭제할 필요가 없습니다.

```powershell
$env:LOTTO_BUILD_CONCURRENCY = '1'
$env:LOTTO_BUILD_REQUEST_GAP_MS = '1500'
pnpm data:build
```
