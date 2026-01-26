module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    'prettier/prettier': 'off',
  },
  overrides: [
    {
      files: ['jest.setup.js', '__tests__/**/*.{js,jsx,ts,tsx}'],
      env: {
        jest: true,
      },
    },
  ],
};
