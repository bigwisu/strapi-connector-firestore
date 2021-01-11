import type { CollectionReference } from '@google-cloud/firestore';
import type { FirestoreConnectorModel } from '../model';
import type { QueryableCollection } from './queryable-collection';


export class QueryableComponentCollection<T extends object = never> implements QueryableCollection<T> {

  private dummyCollection: CollectionReference
  constructor({ firestore, collectionName }: FirestoreConnectorModel<T>) {
    this.dummyCollection = firestore.collection(collectionName);
  }

  private throw(): never {
    throw new Error(
      'Operations are not supported on component collections. ' +
      'This connector embeds components directly into the parent document.'
    );
  }

  get conv() {
    return this.throw();
  }

  get path() {
    return this.throw();
  }

  autoId(): string {
    // This is used to generate IDs for components
    return this.dummyCollection.doc().id;
  }
  
  doc() {
    return this.throw();
  }

  get() {
    return this.throw();
  }

  where() {
    return this.throw();
  }

  whereAny() {
    return this.throw();
  }

  orderBy() {
    return this.throw();
  }

  limit() {
    return this.throw();
  }

  offset() {
    return this.throw();
  }
}
