import { PrismaClient } from "@prisma/client";

export type DatabaseConnection = {
  databaseUrl: string;
};

export function createPrismaClient(connection: DatabaseConnection) {
  return new PrismaClient({
    datasources: {
      db: {
        url: connection.databaseUrl,
      },
    },
  });
}
