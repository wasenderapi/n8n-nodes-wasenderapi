import type {
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
} from 'n8n-workflow';

import { wasenderApiRequest } from '../shared/transport';

type GroupSummary = {
	id?: string;
	jid?: string;
	name?: string;
	imgUrl?: string | null;
};

type GroupsResponse = {
	data?:
		| {
				items?: GroupSummary[];
				pagination?: {
					totalPages?: number;
				};
		  }
		| GroupSummary[];
};

export async function getGroups(
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

	let responseData: GroupsResponse = {};

	try {
		responseData = (await wasenderApiRequest.call(this, 'selectedSession', 'GET', '/groups', {
			sessionId,
			qs: {
				paginated: true,
				page,
				limit,
			},
		})) as GroupsResponse;
	} catch {
		responseData = {};
	}

	const items = Array.isArray(responseData.data)
		? responseData.data
		: (responseData.data?.items ?? []);

	const normalizedFilter = filter?.toLowerCase().trim();
	const filteredItems = items.filter((group) => {
		if (!normalizedFilter) {
			return true;
		}

		const searchable = [group.jid, group.id, group.name].filter(Boolean).join(' ').toLowerCase();

		return searchable.includes(normalizedFilter);
	});

	const results: INodeListSearchItems[] = filteredItems.map((group) => ({
		name: group.name ?? group.jid ?? group.id ?? 'Unknown group',
		value: group.jid ?? group.id ?? '',
		description: group.jid ?? group.id,
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
