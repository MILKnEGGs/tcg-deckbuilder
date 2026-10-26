import { roundTripSuite } from '@milk/core/testing';
import { game } from './game';

// The downloaded card list, if "npm run data" has run (it isn't committed).
roundTripSuite(game, import.meta.glob('../public/data/cards.json', { eager: true, import: 'default' }));
