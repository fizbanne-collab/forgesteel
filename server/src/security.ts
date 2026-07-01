import { createHash, randomBytes } from 'node:crypto';

export const createToken = (size = 32) => randomBytes(size).toString('base64url');

export const hashToken = (token: string) => {
	return createHash('sha256').update(token).digest('hex');
};

export const createCodeChallenge = (verifier: string) => {
	return createHash('sha256').update(verifier).digest('base64url');
};
