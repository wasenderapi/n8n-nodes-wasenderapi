import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';

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

const sessionDetailsCache = new WeakMap<object, Map<string, Promise<WasenderSessionDetails>>>();

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
		return this.helpers.httpRequest.call(this, requestOptions);
	}

	if (credentialType === 'wasenderAccountApi') {
		return this.helpers.httpRequestWithAuthentication.call(
			this,
			'wasenderAccountApi',
			requestOptions,
		);
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

	return this.helpers.httpRequest.call(this, requestOptions);
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
	const response = (await this.helpers.httpRequestWithAuthentication.call(
		this,
		'wasenderAccountApi',
		requestOptions,
	)) as WasenderSessionDetailsResponse;

	return (response.data ?? {}) as WasenderSessionDetails;
}
