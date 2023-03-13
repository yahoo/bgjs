export interface Message {
    type: string;
}

export class InitMessage implements Message {
    type: string = "init";
}

export class InitResponseMessage implements Message {
    type: string = "init-response";
}