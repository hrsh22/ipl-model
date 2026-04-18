const cleanValue = (value: string) => value.trim().replace(/\s+/g, " ")
const cleanPlayerValue = (value: string) => cleanValue(value).toLowerCase().replace(/[^a-z0-9 ]/g, "").trim()

export const TEAM_ALIAS_MAP: Record<string, string> = {
  "Delhi Daredevils": "Delhi Capitals",
  "Kings XI Punjab": "Punjab Kings",
  "Rising Pune Supergiant": "Rising Pune Supergiants",
  "Royal Challengers Bangalore": "Royal Challengers Bengaluru",
}

export const VENUE_ALIAS_MAP: Record<string, string> = {
  "M.Chinnaswamy Stadium": "M Chinnaswamy Stadium",
  "M Chinnaswamy Stadium, Bengaluru": "M Chinnaswamy Stadium",
  "Eden Gardens Stadium": "Eden Gardens",
  "Punjab Cricket Association Stadium": "Punjab Cricket Association IS Bindra Stadium, Mohali",
  "Punjab Cricket Association Stadium, Mohali": "Punjab Cricket Association IS Bindra Stadium, Mohali",
  "PCA Stadium": "Punjab Cricket Association IS Bindra Stadium, Mohali",
  "IS Bindra Stadium": "Punjab Cricket Association IS Bindra Stadium, Mohali",
  "Punjab Cricket Association IS Bindra Stadium, Mohali, Chandigarh": "Punjab Cricket Association IS Bindra Stadium, Mohali",
  "New International Cricket Stadium": "Maharaja Yadavindra Singh International Cricket Stadium",
  "Maharaja Yadavindra Singh Stadium": "Maharaja Yadavindra Singh International Cricket Stadium",
  "Maharaja Yadavindra Singh International Cricket Stadium, Mullanpur": "Maharaja Yadavindra Singh International Cricket Stadium",
  "Maharaja Yadavindra Singh International Cricket Stadium, New Chandigarh": "Maharaja Yadavindra Singh International Cricket Stadium",
  "Rajiv Gandhi International Stadium": "Rajiv Gandhi International Stadium, Uppal",
  "Rajiv Gandhi Intl. Cricket Stadium": "Rajiv Gandhi International Stadium, Uppal",
  "Rajiv Gandhi International Stadium, Uppal, Hyderabad": "Rajiv Gandhi International Stadium, Uppal",
  "MA Chidambaram Stadium": "MA Chidambaram Stadium",
  "Punjab Cricket Association IS Bindra Stadium": "Punjab Cricket Association IS Bindra Stadium, Mohali",
  "MA Chidambaram Stadium, Chepauk": "MA Chidambaram Stadium",
  "MA Chidambaram Stadium, Chepauk, Chennai": "MA Chidambaram Stadium",
  "M. A. Chidambaram Stadium": "MA Chidambaram Stadium",
  "Narendra Modi Stadium, Ahmedabad": "Narendra Modi Stadium",
  "Sardar Patel Stadium, Motera": "Narendra Modi Stadium",
  "Ekana Cricket Stadium": "Bharat Ratna Shri Atal Bihari Vajpayee Ekana Cricket Stadium",
  "BRSABV Ekana Cricket Stadium": "Bharat Ratna Shri Atal Bihari Vajpayee Ekana Cricket Stadium",
  "Bharat Ratna Shri Atal Bihari Vajpayee Ekana Cricket Stadium, Lucknow": "Bharat Ratna Shri Atal Bihari Vajpayee Ekana Cricket Stadium",
  "ACA-VDCA Cricket Stadium": "Dr Y.S. Rajasekhara Reddy ACA-VDCA Cricket Stadium",
  "Dr. Y.S. Rajasekhara Reddy ACA-VDCA Cricket Stadium": "Dr Y.S. Rajasekhara Reddy ACA-VDCA Cricket Stadium",
  "Dr. Y.S. Rajasekhara Reddy ACA-VDCA Cricket Stadium, Visakhapatnam": "Dr Y.S. Rajasekhara Reddy ACA-VDCA Cricket Stadium",
  "ACA Stadium": "Barsapara Cricket Stadium",
  "Assam Cricket Association Stadium": "Barsapara Cricket Stadium",
  "Dr Bhupen Hazarika Cricket Stadium": "Barsapara Cricket Stadium",
  "Barsapara Cricket Stadium, Guwahati": "Barsapara Cricket Stadium",
  "Arun Jaitley Stadium, Delhi": "Arun Jaitley Stadium",
  "Sawai Mansingh Stadium, Jaipur": "Sawai Mansingh Stadium",
  "Himachal Pradesh Cricket Association Stadium, Dharamsala": "Himachal Pradesh Cricket Association Stadium",
  "Maharashtra Cricket Association Stadium, Pune": "Maharashtra Cricket Association Stadium",
  "Subrata Roy Sahara Stadium, Pune": "Subrata Roy Sahara Stadium",
  "JSCA International Stadium Complex, Ranchi": "JSCA International Stadium Complex",
  "Shaheed Veer Narayan Singh International Stadium, Raipur": "Shaheed Veer Narayan Singh International Stadium",
  "Wankhede Stadium, Mumbai": "Wankhede Stadium",
  "Brabourne Stadium, Mumbai": "Brabourne Stadium",
  "Eden Gardens, Kolkata": "Eden Gardens",
}

export const CITY_ALIAS_MAP: Record<string, string> = {
  Bangalore: "Bengaluru",
}

export const normalizeTeamName = (value: string): string => {
  const cleaned = cleanValue(value)

  return TEAM_ALIAS_MAP[cleaned] ?? cleaned
}

export const normalizeVenueName = (value: string): string => {
  const cleaned = cleanValue(value)

  return VENUE_ALIAS_MAP[cleaned] ?? cleaned
}

export const normalizeCityName = (value: string): string => {
  const cleaned = cleanValue(value)

  return CITY_ALIAS_MAP[cleaned] ?? cleaned
}

export const getAliasMetadata = () => ({
  teamAliases: TEAM_ALIAS_MAP,
  venueAliases: VENUE_ALIAS_MAP,
  cityAliases: CITY_ALIAS_MAP,
})

export const normalizePlayerNameKey = (value: string): string => cleanPlayerValue(value)
