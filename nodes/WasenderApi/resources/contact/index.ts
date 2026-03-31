import type { INodeProperties } from 'n8n-workflow';

import { contactJidSelect, createPaginationFields, showFor } from '../../shared/descriptions';

export const contactDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: showFor('contact'),
		options: [
			{ name: 'Block Contact', value: 'block', action: 'Block contact' },
			{
				name: 'Check on Whatsapp',
				value: 'checkOnWhatsApp',
				action: 'Check number on whatsapp',
			},
			{ name: 'Create or Update', value: 'upsert', action: 'Create or update contact' },
			{ name: 'Get Contact', value: 'get', action: 'Get contact' },
			{ name: 'Get Contact Picture', value: 'getPicture', action: 'Get contact profile picture' },
			{
				name: 'Get LID From Phone',
				value: 'getLidFromPhone',
				action: 'Get lid from phone number',
			},
			{ name: 'Get Many', value: 'getAll', action: 'Get many contacts' },
			{
				name: 'Get Phone From LID',
				value: 'getPhoneFromLid',
				action: 'Get phone number from lid',
			},
			{ name: 'Unblock Contact', value: 'unblock', action: 'Unblock contact' },
		],
		default: 'getAll',
	},
	...createPaginationFields('contact', ['getAll'], false),
	{
		...contactJidSelect,
		displayOptions: showFor('contact', ['get', 'getPicture', 'upsert', 'block', 'unblock']),
	},
	{
		displayName: 'Full Name',
		name: 'fullName',
		type: 'string',
		default: '',
		displayOptions: showFor('contact', ['upsert']),
	},
	{
		displayName: 'Save on Primary Address Book',
		name: 'saveOnPrimaryAddressbook',
		type: 'boolean',
		default: false,
		displayOptions: showFor('contact', ['upsert']),
	},
	{
		displayName: 'Phone Number or JID',
		name: 'phoneOrJid',
		type: 'string',
		default: '',
		required: true,
		placeholder: '212612345678@s.whatsapp.net',
		displayOptions: showFor('contact', ['checkOnWhatsApp', 'getLidFromPhone']),
	},
	{
		displayName: 'LID',
		name: 'lid',
		type: 'string',
		default: '',
		required: true,
		placeholder: '12345678901@lid',
		displayOptions: showFor('contact', ['getPhoneFromLid']),
	},
];
