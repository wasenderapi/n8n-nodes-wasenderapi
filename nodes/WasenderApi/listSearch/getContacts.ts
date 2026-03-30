import type {
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
} from 'n8n-workflow';

import { wasenderApiRequest } from '../shared/transport';

type ContactSummary = {
	id?: string;
	jid?: string;
	name?: string;
	notify?: string;
	verifiedName?: string;
	imgUrl?: string | null;
};

type ContactsResponse = {
	data?:
		| {
				items?: ContactSummary[];
				pagination?: {
					totalPages?: number;
				};
		  }
		| ContactSummary[];
};

export async function getContacts(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const sessionId = getSelectedSessionId.call(this);

	if (!sessionId) {
		return { results: [] };
	}

	const page = paginationToken ? Number(paginationToken) : 1;
	const limit = 100;

	let responseData: ContactsResponse = {};

	try {
		responseData = (await wasenderApiRequest.call(this, 'selectedSession', 'GET', '/contacts', {
			sessionId,
			qs: {
				paginated: true,
				page,
				limit,
			},
		})) as ContactsResponse;
	} catch {
		responseData = {};
	}

	const items = Array.isArray(responseData.data)
		? responseData.data
		: (responseData.data?.items ?? []);

	const normalizedFilter = filter?.toLowerCase().trim();
	const filteredItems = items.filter((contact) => {
		if (!normalizedFilter) {
			return true;
		}

		const searchable = [contact.jid, contact.id, contact.name, contact.notify, contact.verifiedName]
			.filter(Boolean)
			.join(' ')
			.toLowerCase();

		return searchable.includes(normalizedFilter);
	});

	const results: INodeListSearchItems[] = filteredItems.map((contact) => ({
		name:
			contact.name ??
			contact.notify ??
			contact.verifiedName ??
			contact.jid ??
			contact.id ??
			'Unknown contact',
		value: contact.jid ?? contact.id ?? '',
		description: contact.jid ?? contact.id,
	}));

	const totalPages = Array.isArray(responseData.data)
		? undefined
		: responseData.data?.pagination?.totalPages;

	return {
		results,
		paginationToken: totalPages && page < totalPages ? String(page + 1) : undefined,
	};
}

function getSelectedSessionId(this: ILoadOptionsFunctions): string | undefined {
	const sessionId = this.getCurrentNodeParameter('sessionId', {
		extractValue: true,
	}) as string | undefined;
	const autoSelectedSessionId = getOptionalCurrentNodeParameter.call(
		this,
		'autoSelectedSessionId',
	) as string | number | undefined;

	return normalizeSessionIdValue(sessionId) ?? normalizeSessionIdValue(autoSelectedSessionId);
}

function getOptionalCurrentNodeParameter(
	this: ILoadOptionsFunctions,
	parameterName: string,
): unknown {
	try {
		return this.getCurrentNodeParameter(parameterName);
	} catch {
		return undefined;
	}
}

function normalizeSessionIdValue(value: unknown): string | undefined {
	if (typeof value === 'string') {
		const trimmedValue = value.trim();
		return trimmedValue === '' ? undefined : trimmedValue;
	}

	if (typeof value === 'number' && Number.isFinite(value)) {
		return String(value);
	}

	return undefined;
}
