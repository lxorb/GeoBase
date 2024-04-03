import { ObjectId } from 'mongodb';
import { Request } from 'express';

export type Coordinates = [number, number];

export interface Storypoint {
    _id: ObjectId;
    title: string;
    description: string;
    coordinates: Coordinates;
    created_at: number;
    created_by: ObjectId;
    coords: Coordinates;
    files: ObjectId[];
    company_id: ObjectId;
    history: [];
    distanceInKm?: number;
}

export interface company {
    _id: ObjectId;
    name: string;
    description: string;
    created_at: number;
    user_ids: ObjectId[];
    storypoint_ids: ObjectId[];
}

export interface User {
    _id: ObjectId;
    fullname: string;
    email: string;
    password: string;
    created_at: number;
    company_id: ObjectId;
}

export interface File {
    _id: ObjectId;
    filename: string;
    created_by: number;
    storypoint_id: ObjectId;
}

declare global {
    namespace Express {
        interface Request {
            user?: User;
            file?: any;
        }
    }
}

