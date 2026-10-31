// Example k6 test with two scenarios. Writes the JSON summary p95 Guard reads.
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333';

export const options = {
  // p(99) is not in k6's default trend stats, so ask for it explicitly.
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    browse: { executor: 'constant-vus', vus: 5, duration: __ENV.DURATION || '10s', exec: 'browse' },
    checkout: { executor: 'constant-vus', vus: 2, duration: __ENV.DURATION || '10s', exec: 'checkout' },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
    // Thresholds on tagged sub-metrics make k6 include per-scenario numbers in the summary.
    'http_req_duration{scenario:browse}': ['p(95)<400'],
    'http_req_duration{scenario:checkout}': ['p(95)<800'],
  },
};

export function browse() {
  const res = http.get(`${BASE_URL}/products`);
  check(res, { 'status is 200': (r) => r.status === 200 });
}

export function checkout() {
  const res = http.post(`${BASE_URL}/checkout`, JSON.stringify({ items: 3 }));
  check(res, { 'status is 200': (r) => r.status === 200 });
}

export function handleSummary(data) {
  return {
    [__ENV.SUMMARY_FILE || 'k6-summary.json']: JSON.stringify(data, null, 2),
  };
}
