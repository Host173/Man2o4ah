export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Agent commit bodies and Co-Authored-By trailers are long.
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
