// Upper bound on the size of a PDF selection crop (PNG payload) accepted from
// webviews and external agent surfaces. Kept here, independent of the disabled
// Ask PDF feature, because crop validation is shared across surfaces.
export const MAX_PNG_BYTES = 5 * 1024 * 1024;
