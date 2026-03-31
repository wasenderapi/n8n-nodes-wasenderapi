import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';

declare function setTimeout(callback: () => void, delay: number): unknown;

type WasenderContext =
	| IExecuteFunctions
	| IHookFunctions
	| ILoadOptionsFunctions
	| IWebhookFunctions;

export type WasenderCredentialType = 'wasenderAccountApi' | 'selectedSession' | 'none';

export interface WasenderSessionDetails extends IDataObject {
	id?: number | string;
	name?: string;
	phone_number?: string;
	status?: string;
	api_key?: string;
	webhook_secret?: string;
	webhook_enabled?: boolean;
	webhook_url?: string;
	webhook_events?: string[];
}

interface WasenderRequestOptions {
	body?: IDataObject;
	qs?: IDataObject;
	headers?: IDataObject;
	sessionId?: string;
}

interface WasenderSessionDetailsResponse {
	data?: WasenderSessionDetails;
}

interface WasenderRetrySettings {
	retryOnFail: boolean;
	maxRetries: number;
}

const sessionDetailsCache = new WeakMap<object, Map<string, Promise<WasenderSessionDetails>>>();
const retryableStatusCodes = new Set([408, 429, 500, 502, 503]);
const maxRetryAfterSeconds = 60;
const defaultRetrySettings: WasenderRetrySettings = {
	retryOnFail: true,
	maxRetries: 10,
};

function normalizeBaseUrl(baseUrl?: string): string {
	const trimmedBaseUrl = (baseUrl ?? 'https://www.wasenderapi.com/api').trim().replace(/\/+$/, '');

	if (trimmedBaseUrl.endsWith('/api')) {
		return trimmedBaseUrl;
	}

	return `${trimmedBaseUrl}/api`;
}

export async function wasenderApiRequest(
	this: WasenderContext,
	credentialType: WasenderCredentialType,
	method: IHttpRequestMethods,
	endpoint: string,
	options: WasenderRequestOptions = {},
) {
	const requestOptions = await createRequestOptions.call(this, method, endpoint, options);

	if (credentialType === 'none') {
		return await executeRequestWithRetry.call(this, async () => {
			return await this.helpers.httpRequest.call(this, requestOptions);
		});
	}

	if (credentialType === 'wasenderAccountApi') {
		return await executeRequestWithRetry.call(this, async () => {
			return await this.helpers.httpRequestWithAuthentication.call(
				this,
				'wasenderAccountApi',
				requestOptions,
			);
		});
	}

	const sessionId = options.sessionId?.trim();

	if (!sessionId) {
		throw new Error('Session ID is required for session-scoped WasenderAPI requests');
	}

	const sessionDetails = await getWasenderSessionDetails.call(this, sessionId);
	const apiKey = String(sessionDetails.api_key ?? '').trim();

	if (apiKey === '') {
		throw new Error(`Selected WasenderAPI session ${sessionId} does not have an API key`);
	}

	requestOptions.headers = {
		...(requestOptions.headers ?? {}),
		Authorization: `Bearer ${apiKey}`,
	};

	return await executeRequestWithRetry.call(this, async () => {
		return await this.helpers.httpRequest.call(this, requestOptions);
	});
}

export async function getWasenderSessionDetails(
	this: WasenderContext,
	sessionId: string,
): Promise<WasenderSessionDetails> {
	const normalizedSessionId = sessionId.trim();
	let cachedSessions = sessionDetailsCache.get(this as object);

	if (!cachedSessions) {
		cachedSessions = new Map<string, Promise<WasenderSessionDetails>>();
		sessionDetailsCache.set(this as object, cachedSessions);
	}

	const cachedDetails = cachedSessions.get(normalizedSessionId);

	if (cachedDetails) {
		return await cachedDetails;
	}

	const detailsPromise = fetchWasenderSessionDetails.call(this, normalizedSessionId);
	cachedSessions.set(normalizedSessionId, detailsPromise);

	try {
		return await detailsPromise;
	} catch (error) {
		cachedSessions.delete(normalizedSessionId);
		throw error;
	}
}

async function createRequestOptions(
	this: WasenderContext,
	method: IHttpRequestMethods,
	endpoint: string,
	options: WasenderRequestOptions,
): Promise<IHttpRequestOptions> {
	const accountCredentials = (await this.getCredentials('wasenderAccountApi')) as IDataObject;
	const baseUrl = normalizeBaseUrl(accountCredentials.baseUrl as string | undefined);
	const requestOptions: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${endpoint}`,
		json: true,
	};

	if (options.qs && Object.keys(options.qs).length > 0) {
		requestOptions.qs = options.qs;
	}

	if (options.body && Object.keys(options.body).length > 0) {
		requestOptions.body = options.body;
	}

	if (options.headers && Object.keys(options.headers).length > 0) {
		requestOptions.headers = options.headers;
	}

	return requestOptions;
}

async function fetchWasenderSessionDetails(
	this: WasenderContext,
	sessionId: string,
): Promise<WasenderSessionDetails> {
	const requestOptions = await createRequestOptions.call(
		this,
		'GET',
		`/whatsapp-sessions/${encodeURIComponent(sessionId)}`,
		{},
	);
	const response = (await executeRequestWithRetry.call(this, async () => {
		return await this.helpers.httpRequestWithAuthentication.call(
			this,
			'wasenderAccountApi',
			requestOptions,
		);
	})) as WasenderSessionDetailsResponse;

	return (response.data ?? {}) as WasenderSessionDetails;
}

async function executeRequestWithRetry<T>(
	this: WasenderContext,
	requestFn: () => Promise<T>,
): Promise<T> {
	const retrySettings = getRetrySettings.call(this);

	if (!retrySettings.retryOnFail || retrySettings.maxRetries < 1) {
		return await requestFn();
	}

	let retryCount = 0;

	while (true) {
		try {
			return await requestFn();
		} catch (error) {
			if (!shouldRetryRequest(error) || retryCount >= retrySettings.maxRetries) {
				throw error;
			}

			retryCount += 1;
			await sleep(resolveRetryDelayMs(error, retryCount));
		}
	}
}

function getRetrySettings(this: WasenderContext): WasenderRetrySettings {
	const getNodeParameter = (
		this as unknown as {
			getNodeParameter?: (name: string, arg1?: unknown, arg2?: unknown, arg3?: unknown) => unknown;
		}
	).getNodeParameter;

	if (!getNodeParameter) {
		return defaultRetrySettings;
	}

	try {
		const requestOptions = getNodeParameter.call(this, 'requestOptions', 0, {});

		if (!isObject(requestOptions)) {
			return defaultRetrySettings;
		}

		const retryOnFail =
			typeof requestOptions.retryOnFail === 'boolean'
				? requestOptions.retryOnFail
				: defaultRetrySettings.retryOnFail;
		const maxRetries = normalizeRetryCount(requestOptions.maxRetries);

		return {
			retryOnFail,
			maxRetries,
		};
	} catch {
		return defaultRetrySettings;
	}
}

function normalizeRetryCount(value: unknown): number {
	const parsedValue = toNumber(value);

	if (typeof parsedValue === 'undefined' || !Number.isFinite(parsedValue) || parsedValue < 0) {
		return defaultRetrySettings.maxRetries;
	}

	return Math.floor(parsedValue);
}

function shouldRetryRequest(error: unknown): boolean {
	const statusCode = getErrorStatusCode(error);

	return typeof statusCode === 'number' && retryableStatusCodes.has(statusCode);
}

function resolveRetryDelayMs(error: unknown, retryCount: number): number {
	const retryAfterSeconds = getRetryAfterSeconds(error);

	if (typeof retryAfterSeconds === 'number') {
		return Math.max(retryAfterSeconds * 1000, 0);
	}

	const rateLimitResetDelayMs = getRateLimitResetDelayMs(error);

	if (typeof rateLimitResetDelayMs === 'number') {
		return rateLimitResetDelayMs;
	}

	return Math.min(1000 * 2 ** (retryCount - 1), 30000);
}

function getRetryAfterSeconds(error: unknown): number | undefined {
	for (const payload of getErrorPayloads(error)) {
		const retryAfter = toNumber(payload.retry_after ?? payload.retryAfter);

		if (typeof retryAfter === 'number') {
			return Math.min(Math.max(retryAfter, 0), maxRetryAfterSeconds);
		}
	}

	for (const headers of getErrorHeaders(error)) {
		const retryAfterHeader = getHeaderValue(headers, 'retry-after');

		if (typeof retryAfterHeader === 'undefined') {
			continue;
		}

		const retryAfterSeconds = toNumber(retryAfterHeader);

		if (typeof retryAfterSeconds === 'number') {
			return Math.min(Math.max(retryAfterSeconds, 0), maxRetryAfterSeconds);
		}

		const retryAfterDate = Date.parse(String(retryAfterHeader));

		if (!Number.isNaN(retryAfterDate)) {
			return Math.min(Math.max((retryAfterDate - Date.now()) / 1000, 0), maxRetryAfterSeconds);
		}
	}

	return undefined;
}

function getRateLimitResetDelayMs(error: unknown): number | undefined {
	for (const headers of getErrorHeaders(error)) {
		const resetHeader = getHeaderValue(headers, 'x-ratelimit-reset');
		const resetValue = toNumber(resetHeader);

		if (typeof resetValue !== 'number') {
			continue;
		}

		// Wasender documents this header as both seconds-until-reset and reset timestamp.
		const nowInSeconds = Math.floor(Date.now() / 1000);

		if (resetValue > nowInSeconds + 5) {
			return Math.max(resetValue * 1000 - Date.now(), 0);
		}

		return Math.max(resetValue * 1000, 0);
	}

	return undefined;
}

function getErrorStatusCode(error: unknown): number | undefined {
	for (const candidate of getErrorObjects(error)) {
		const statusCode = toNumber(
			candidate.statusCode ?? candidate.status ?? candidate.httpCode ?? candidate.responseCode,
		);

		if (typeof statusCode === 'number') {
			return statusCode;
		}
	}

	return undefined;
}

function getErrorPayloads(error: unknown): IDataObject[] {
	const payloads: IDataObject[] = [];

	for (const candidate of getErrorObjects(error)) {
		const bodyPayload = toObject(candidate.body);
		const dataPayload = toObject(candidate.data);

		if (bodyPayload) {
			payloads.push(bodyPayload);
		}

		if (dataPayload) {
			payloads.push(dataPayload);
		}
	}

	return payloads;
}

function getErrorHeaders(error: unknown): IDataObject[] {
	const headersList: IDataObject[] = [];

	for (const candidate of getErrorObjects(error)) {
		const headers = toObject(candidate.headers);

		if (headers) {
			headersList.push(headers);
		}
	}

	return headersList;
}

function getErrorObjects(error: unknown): IDataObject[] {
	const objects: IDataObject[] = [];
	const seen = new Set<object>();
	const queue: unknown[] = [error];

	while (queue.length > 0) {
		const currentValue = queue.shift();

		if (!isObject(currentValue) || seen.has(currentValue)) {
			continue;
		}

		seen.add(currentValue);
		objects.push(currentValue);
		queue.push(currentValue.response, currentValue.context, currentValue.cause);
	}

	return objects;
}

function getHeaderValue(headers: IDataObject, headerName: string): unknown {
	const normalizedHeaderName = headerName.toLowerCase();

	for (const [currentHeaderName, headerValue] of Object.entries(headers)) {
		if (currentHeaderName.toLowerCase() === normalizedHeaderName) {
			return headerValue;
		}
	}

	return undefined;
}

function toObject(value: unknown): IDataObject | undefined {
	if (isObject(value)) {
		return value;
	}

	if (typeof value !== 'string') {
		return undefined;
	}

	try {
		const parsedValue = JSON.parse(value) as unknown;

		return isObject(parsedValue) ? parsedValue : undefined;
	} catch {
		return undefined;
	}
}

function toNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value !== 'string') {
		return undefined;
	}

	const trimmedValue = value.trim();

	if (trimmedValue === '') {
		return undefined;
	}

	const parsedValue = Number(trimmedValue);

	return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function isObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function sleep(delayMs: number): Promise<void> {
	if (delayMs <= 0) {
		return;
	}

	await new Promise<void>((resolve) => {
		setTimeout(resolve, delayMs);
	});
}
