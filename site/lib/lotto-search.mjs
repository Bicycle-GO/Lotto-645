const REGION_NAMES = {
  서울: '서울특별시',
  부산: '부산광역시',
  대구: '대구광역시',
  인천: '인천광역시',
  광주: '광주광역시',
  대전: '대전광역시',
  울산: '울산광역시',
  세종: '세종특별자치시',
  경기: '경기도',
  강원: '강원특별자치도',
  충북: '충청북도',
  충남: '충청남도',
  전북: '전북특별자치도',
  전남: '전라남도',
  경북: '경상북도',
  경남: '경상남도',
  제주: '제주특별자치도',
};

/** @param {{ region: string, address: string }} store */
export function storeArea(store) {
  // Some historical official records use this legacy province/city prefix.
  const parts = store.address.trim().split(/\s+/).slice(1);
  const region =
    store.region === '전남광주'
      ? ['동구', '서구', '남구', '북구', '광산구'].includes(parts[0])
        ? '광주'
        : '전남'
      : store.region;
  const district =
    region === '세종'
      ? ''
      : parts
          .slice(0, 2)
          .filter((part, index) =>
            index === 0 ? /[시군구]$/.test(part) : part.endsWith('구'),
          )
          .join(' ');
  return { region, district };
}

/** @param {{ name: string, region: string, address: string }} store */
export function searchText(store) {
  const { region } = storeArea(store);
  const address = store.address.replace(/^전남광주(?=\s)/, region);
  return `${store.name} ${address} ${region} ${REGION_NAMES[region] || ''}`.toLocaleLowerCase(
    'ko-KR',
  );
}

/** @param {string} text @param {string} query */
export function matchesSearch(text, query) {
  return query
    .trim()
    .toLocaleLowerCase('ko-KR')
    .split(/\s+/)
    .every((word) => text.includes(word));
}

/** @param {{ region: string, address: string }} store @param {string} region @param {string} district */
export function matchesArea(store, region, district) {
  const area = storeArea(store);
  return (
    (region === 'all' || area.region === region) &&
    (district === 'all' || area.district === district)
  );
}

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * sinDLng * sinDLng;

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export { REGION_NAMES };
