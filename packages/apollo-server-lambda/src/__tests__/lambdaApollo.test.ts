import { ApolloServer } from '../ApolloServer';
import testSuite, {
  schema as Schema,
  CreateAppOptions,
  NODE_MAJOR_VERSION,
} from 'apollo-server-integration-testsuite';
import { Config } from 'apollo-server-core';
import gql from 'graphql-tag';
import request from 'supertest';
import {createMockServer} from './mockServer';

const createLambda = (options: CreateAppOptions = {}) => {
  const server = new ApolloServer(
    (options.graphqlOptions as Config) || { schema: Schema },
  );

  const handler = server.createHandler();

  return createMockServer(handler);
}

describe('integration:Lambda', () => {
  testSuite(createLambda);
});

const typeDefs = gql`
  type File {
    filename: String!
    mimetype: String!
    encoding: String!
  }
  type Query {
    uploads: [File]
    helloWorld: String
  }
  type Mutation {
    singleUpload(file: Upload!): File!
    multiUpload(files: [Upload!]!): [File]!
  }
`;

const resolvers = {
  Query: {
    uploads() { },
    helloWorld() { return 'hi'; }
  },
  Mutation: {
    async singleUpload(_parent: any, { file }: { file: any }) {
      expect((await file).createReadStream).toBeDefined();
      return file;
    },
    async multiUpload(_parent: any, { files }: { files: any }) {
      const fileArray = await files;
      fileArray.forEach(async (file: any) => {
        expect((await file).createReadStream).toBeDefined();
      });
      return fileArray;
    },
  },
};


// NODE: Skip Node.js 6 and 14, but only because `graphql-upload`
// doesn't support them on the version use use.
(
  [6, 14].includes(NODE_MAJOR_VERSION) ? describe.skip : describe
)('file uploads', () => {
  let app = <any>null
  beforeAll(async () => {
    app = await createLambda({
      graphqlOptions: {
        typeDefs,
        resolvers,
      },
    });
  });

  it('allows for a standard query without uploads', async () => {
    const req = request(app)
      .post('/graphql')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .send({
        query: `query{helloWorld}`
      });
    const res = await req;
    expect(res.statusCode).toBe(200);
    expect(res.body.data.helloWorld).toBe('hi')
  });

  it('allows for uploading a single file', async () => {
    const expected = {
      filename: 'package.json',
      encoding: '7bit',
      mimetype: 'application/json',
    };

    const req = request(app)
      .post('/graphql')
      .set('Content-Type', 'multipart/form-data')
      .field(
        'operations',
        JSON.stringify({
          query: `
            mutation($file: Upload!) {
              singleUpload(file: $file) {
                filename
                encoding
                mimetype
              }
            }
          `,
          variables: {
            file: null,
          },
        }),
      )
      .field('map', JSON.stringify({ 0: ['variables.file'] }))
      .attach('0', 'package.json');
    return req.then((res: any) => {
      expect(res.status).toEqual(200);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.singleUpload).toEqual(expected);
    });
  });

  it('allows for uploading multiple files', async () => {
    const expected = [{
      filename: 'package.json',
      encoding: '7bit',
      mimetype: 'application/json',
    },
    {
      filename: 'tsconfig.json',
      encoding: '7bit',
      mimetype: 'application/json',
    }];

    const req = request(app)
      .post('/graphql')
      .type('form')
      .field(
        'operations',
        JSON.stringify({
          query: `
            mutation($files: [Upload!]!) {
              multiUpload(files: $files) {
                filename
                encoding
                mimetype
              }
            }
          `,
          variables: {
            files: [null, null],
          },
        }),
      )
      .field('map', JSON.stringify({ 0: ['variables.files.0'], 1: ['variables.files.1'] }))
      .attach('0', 'package.json')
      .attach('1', 'tsconfig.json');
    return req.then((res: any) => {
      expect(res.status).toEqual(200);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.multiUpload).toEqual(expected);
    });
  });
});
