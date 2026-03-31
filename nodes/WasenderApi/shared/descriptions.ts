import type { INodeProperties } from 'n8n-workflow';

export function showFor(resource: string, operations?: string[]) {
	return operations
		? { show: { resource: [resource], operation: operations } }
		: { show: { resource: [resource] } };
}

export const sessionIdSelect: INodeProperties = {
	displayName: 'Session',
	name: 'sessionId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			placeholder: 'Select a session...',
			typeOptions: {
				searchListMethod: 'getSessions',
				searchable: true,
				searchFilterRequired: false,
			},
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 1',
		},
	],
};

export const contactJidSelect: INodeProperties = {
	displayName: 'Contact',
	name: 'contactJid',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	typeOptions: {
		loadOptionsDependsOn: ['sessionId.value'],
	},
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			placeholder: 'Select a contact...',
			typeOptions: {
				searchListMethod: 'getContacts',
				searchable: true,
				searchFilterRequired: false,
			},
		},
		{
			displayName: 'By JID',
			name: 'jid',
			type: 'string',
			placeholder: 'e.g. 212612345678@s.whatsapp.net',
		},
	],
};

export const groupJidSelect: INodeProperties = {
	displayName: 'Group',
	name: 'groupJid',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	typeOptions: {
		loadOptionsDependsOn: ['sessionId.value'],
	},
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			placeholder: 'Select a group...',
			typeOptions: {
				searchListMethod: 'getGroups',
				searchable: true,
				searchFilterRequired: false,
			},
		},
		{
			displayName: 'By JID',
			name: 'jid',
			type: 'string',
			placeholder: 'e.g. 123456789-987654321@g.us',
		},
	],
};

export const requestRetryOptions: INodeProperties = {
	displayName: 'Options',
	name: 'requestOptions',
	type: 'collection',
	placeholder: 'Add Option',
	default: {
		retryOnFail: true,
		maxRetries: 10,
	},
	options: [
		{
			displayName: 'Retry Failed Requests',
			name: 'retryOnFail',
			type: 'boolean',
			default: true,
			description:
				'Whether to retry WasenderAPI requests when the API returns 408, 429, 500, 502, or 503',
		},
		{
			displayName: 'Max Retries',
			name: 'maxRetries',
			type: 'number',
			typeOptions: {
				minValue: 0,
			},
			default: 10,
			description: 'How many retry attempts to make after the initial request',
		},
	],
};

export function createPaginationFields(
	resource: string,
	operations: string[],
	returnAllDefault = true,
): INodeProperties[] {
	const displayOptions = showFor(resource, operations);
	const returnAllField: INodeProperties = returnAllDefault
		? {
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: true,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions,
			}
		: {
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions,
			};

	return [
		returnAllField,
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			typeOptions: {
				minValue: 1,
			},
			default: 50,
			description: 'Max number of results to return',
			displayOptions: {
				show: {
					resource: [resource],
					operation: operations,
					returnAll: [false],
				},
			},
		},
		{
			displayName: 'Page',
			name: 'page',
			type: 'number',
			typeOptions: {
				minValue: 1,
			},
			default: 1,
			displayOptions: {
				show: {
					resource: [resource],
					operation: operations,
					returnAll: [false],
				},
			},
		},
	];
}

export function createStringListField(
	displayName: string,
	name: string,
	resource: string,
	operations: string[],
	itemDisplayName: string,
	itemFieldLabel: string,
	placeholder: string,
	description?: string,
): INodeProperties {
	return {
		displayName,
		name,
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
		},
		placeholder: `Add ${itemDisplayName}`,
		default: {},
		description,
		displayOptions: showFor(resource, operations),
		options: [
			{
				name: 'values',
				displayName: itemDisplayName,
				values: [
					{
						displayName: itemFieldLabel,
						name: 'value',
						type: 'string',
						default: '',
						placeholder,
					},
				],
			},
		],
	};
}
