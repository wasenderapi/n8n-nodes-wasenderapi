import type { INodeProperties } from 'n8n-workflow';

import { showFor } from '../../shared/descriptions';

export const sessionDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: showFor('session'),
		options: [
			{
				name: 'Get Current Session Status',
				value: 'getStatus',
				action: 'Get current session status',
			},
			{
				name: 'Get Current Session User Info',
				value: 'getUserInfo',
				action: 'Get current session user info',
			},
			{
				name: 'Send Presence Update',
				value: 'sendPresenceUpdate',
				action: 'Send presence update',
			},
		],
		default: 'getStatus',
	},
	{
		displayName: 'JID',
		name: 'presenceJid',
		type: 'string',
		default: '',
		required: true,
		placeholder: '1234567890@s.whatsapp.net',
		description: 'Use your own JID for available and unavailable presence states',
		displayOptions: showFor('session', ['sendPresenceUpdate']),
	},
	{
		displayName: 'Presence Type',
		name: 'presenceType',
		type: 'options',
		options: [
			{ name: 'Available', value: 'available' },
			{ name: 'Composing', value: 'composing' },
			{ name: 'Paused', value: 'paused' },
			{ name: 'Recording', value: 'recording' },
			{ name: 'Unavailable', value: 'unavailable' },
		],
		default: 'composing',
		displayOptions: showFor('session', ['sendPresenceUpdate']),
	},
	{
		displayName: 'Delay In Milliseconds',
		name: 'delayMs',
		type: 'number',
		typeOptions: {
			minValue: 0,
		},
		default: 0,
		displayOptions: showFor('session', ['sendPresenceUpdate']),
	},
];
