export const verifyToken = async (token: string): Promise<boolean> => {
  return token.trim().length > 0;
};
