export interface Name {
  firstname: string;
  surname: string;
  suffix?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  name?: Name;
  nickname?: string;
  img?: string;
  dateOfBirth?: Date;
  nationality?: string;
  // any other fields from Firestore
}

export interface InfoBlock {
  title: string;
  type: 'none' | 'bullet' | 'check';
  plainText?: string;
  items: string[];
}

export interface Location {
  lat: number;
  lng: number;
}

export interface NearbyAttraction {
  name: string;
  distance: string;
  icon?: string;
}

export interface Destination {
  id: string;
  title?: string;
  name?: string;
  image?: string;
  imageUrl?: string;
  desc?: string;
  description?: string;
  category?: string;
  rating: number;
  reviews: number;
  distance: string;
  location?: Location;
  address?: string;
  ranking?: string;
  hours?: string;
  entrance?: string;
  goodFor?: string | string[];
  parking?: string;
  lastUpdated?: string;
  about?: string;
  history?: string;
  features?: string;
  massSchedule?: string;
  attractions?: string;
  operatingHours?: string;
  packages?: string;
  safety?: string;
  foodCategories?: string;
  mustTryDishes?: string;
  bestTimes?: string;
  parkingInfo?: string;
  walkingTour?: string;
  specialEvents?: string;
  exhibitHalls?: string;
  specialExhibits?: string;
  guidedTours?: string;
  collections?: string;
  researchFacilities?: string;
  visitorServices?: string;
  rules?: string;
  specialPrograms?: string;
  visitorTips?: string;
  nearbyAttractions?: NearbyAttraction[];
  reviewsSummary?: string;
  ecoFeatures?: string;
  infoBlocks?: InfoBlock[];
}