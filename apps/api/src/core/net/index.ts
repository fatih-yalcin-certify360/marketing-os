export { extractReadableText, type ExtractedText } from './html-text.js';
export {
  BLOCKED_RANGES,
  NAMED_METADATA_ADDRESSES,
  classifyAddress,
  isLoopbackAddress,
  type AddressFamily,
  type AddressVerdict,
} from './ip-guard.js';
export {
  FETCHABLE_PORTS,
  RESERVED_SUFFIXES,
  inspectUrl,
  type UrlGuardOptions,
  type UrlRejectionCode,
  type UrlVerdict,
} from './url-guard.js';
export {
  safeFetch,
  type FetchFailure,
  type FetchFailureCode,
  type FetchResult,
  type FetchSuccess,
  type SafeFetchOptions,
} from './safe-fetch.js';
