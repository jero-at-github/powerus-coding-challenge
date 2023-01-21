import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { catchError, map, forkJoin, of, Observable, timer, throwError, mergeMap, race } from 'rxjs';
import { AxiosError } from 'axios';
import { Flight, Flights, Slice } from './flights/flights.interface';

@Injectable()
export class AppService {
  
  private readonly logger = new Logger(AppService.name);
  
  // Time limit for fetching all the flight sources
  private requestTimeLimit: number = 1000;

  // Array for storing the flight sources URLS, add more in case of need
  private flightSources: string[] = [
    'https://coding-challenge.powerus.de/flight/source1', 
    'https://coding-challenge.powerus.de/flight/source2'
  ];

  constructor(private readonly httpService: HttpService) { }

  private mergeResponses(data: Flights[]): any[] {
    let mergedResponse: object[] = [];
    
    for (let response of data) {
      if (response !== null) {
        mergedResponse = mergedResponse.concat(response.flights);
      }
    }

    return mergedResponse;
  }

  private createId(flight: Slice): string {
    // generate an id using the flight number and the departure date
    let departureTs = new Date(flight.departure_date_time_utc).getTime();    
    return `${flight.flight_number}${departureTs}`;    
  }

  private addIdentifiers(data: Flight[]): Flight[] {
    return data.map(flight => {
      flight.slices = flight.slices.map(flight => ({id: this.createId(flight), ...flight}));
      return flight;
    });
  }

  private removeDuplicates(data: Flight[]): Flight[] {
    let composedIds: string[] = [];
    
    return data.filter(flight => { 
      // create a composed id using both flights of a slice
      let composedId: string = `${flight.slices[0].id}${flight.slices[1].id}`;
      if (!composedIds.includes(composedId)) {
        composedIds.push(composedId);            
        return true;
      } else {                
        return false;
      }
    });    
  }

  private removeNulls(data: Flights[]): any[] {
    return data.filter(response => response !== null);
  }

  /**
   * Fetch all the flights from the different sources and process the data   
   * @returns The list of flights to be consumed.
   */
  async getFlights(): Promise<any> {
          
    // creates an observable to fetch a http request
    let createRequest = (sourceUrl =>
      this.httpService.get<Flights>(sourceUrl).
        pipe(
          map(response => response.data),
          catchError((error: AxiosError) => {
            this.logger.error(error.response.data);                        
            return of(null);
          }),
        )
    );

    // creates and array with all the requests and a time limit observables
    let requests: Observable<Flights>[] = this.flightSources.map(source => createRequest(source));
    let limitTime: Observable<never> = timer(this.requestTimeLimit).pipe(
      mergeMap(_ => throwError(() => new Error('Time limit exceeded')))
    );    

    // fetch data and process it
    return new Promise((resolve, reject) => {     
      race(
        forkJoin(requests),
        limitTime
      ).
      subscribe({
        next: responseData => { 
          // if all requests fail return an error
          if (responseData.every(response => response === null)) {
            reject(new Error("No flight sources available at the moment"));          
          } else { 
            // process response data
            let processedData: any[] = [];
            
            processedData = this.removeNulls(responseData);
            processedData = this.mergeResponses(processedData);
            processedData = this.addIdentifiers(processedData);
            processedData = this.removeDuplicates(processedData);  

            resolve(processedData);
          }          
        }, 
        error: (error) => reject(error),
      })             
    });                
  }  
}
