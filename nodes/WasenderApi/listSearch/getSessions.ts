import type {
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
} from 'n8n-workflow';

import { wasenderApiRequest } from '../shared/transport';

type SessionSummary = {
	id: number;
	name?: string;
	phone_number?: string;
	status?: string;
};

type SessionsResponse = {
	data?: SessionSummary[];
};

export async function getSessions(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	let responseData: SessionsResponse = {};

	try {
		responseData = (await wasenderApiRequest.call(
			this,
			'wasenderAccountApi',
			'GET',
			'/whatsapp-sessions',
		)) as SessionsResponse;
	} catch {
		responseData = {};
	}

	const normalizedFilter = filter?.toLowerCase().trim();
	const sessions = (responseData.data ?? []).filter((session) => {
		if (!normalizedFilter) {
			return true;
		}

		const searchable = [session.name, session.phone_number, session.status, String(session.id)]
			.filter(Boolean)
			.join(' ')
			.toLowerCase();

		return searchable.includes(normalizedFilter);
	});

	const results: INodeListSearchItems[] = sessions.map((session) => ({
		name: `${session.name ?? `Session ${session.id}`} (${session.phone_number ?? 'No phone'})`,
		value: String(session.id),
		description: session.status,
	}));

	return { results };
}
