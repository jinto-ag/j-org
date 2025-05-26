export const configs = {
  apiPrefix: '/api/v1',
  jwtSecretKey:
    process.env.JWT_SECRET_KEY ||
    'Secret-key-jwt-sadfklajs8ieqwre9masdfaksljfewruqioeuiouqweiumiusdiufioayweryqwer',
  saltRounds: parseInt(process.env.SALT_ROUNDS || '10', 10),
};
