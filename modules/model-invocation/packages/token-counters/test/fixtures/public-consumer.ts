import * as Api from '@print-an-agent/model-invocation-token-counters';
const measurements = [];
for (const encoding of Object.values(Api.TIKTOKEN_ENCODING)) {
  const counter = Api.resolveTextTokenCounterConfig({ kind: 'tiktoken', encoding });
  measurements.push(
    await counter.measure({ kind: 'text', text: 'hello world' }, new AbortController().signal)
  );
}
const estimated = Api.createCharacterTokenEstimator();
const bound = Api.resolveTextTokenCounterConfig(
  { kind: 'reference', measurementRef: estimated.descriptor.measurementRef },
  () => estimated
);
process.stdout.write(
  JSON.stringify({
    exports: Object.keys(Api).sort(),
    measurements,
    estimated: await bound.measure({ kind: 'text', text: 'hello' }, new AbortController().signal),
  })
);
