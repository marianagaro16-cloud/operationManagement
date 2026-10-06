export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      absence_approvers: {
        Row: {
          added_by: string | null
          created_at: string
          profile_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          profile_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "absence_approvers_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "absence_approvers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      absence_events: {
        Row: {
          absence_id: string
          action: string
          actor_id: string | null
          created_at: string
          detail: Json
          id: number
        }
        Insert: {
          absence_id: string
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: number
        }
        Update: {
          absence_id?: string
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "absence_events_absence_id_fkey"
            columns: ["absence_id"]
            isOneToOne: false
            referencedRelation: "absences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "absence_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      absence_needs_cover: {
        Row: {
          added_by: string | null
          created_at: string
          profile_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          profile_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "absence_needs_cover_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "absence_needs_cover_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      absence_types: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          translations: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          translations?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          translations?: Json
          updated_at?: string
        }
        Relationships: []
      }
      absences: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          end_date: string
          end_time: string | null
          first_day: string
          id: string
          last_day: string
          note: string | null
          profile_id: string
          rejection_reason: string | null
          start_date: string
          start_time: string | null
          status: string
          type_id: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          end_date: string
          end_time?: string | null
          first_day?: string
          id?: string
          last_day?: string
          note?: string | null
          profile_id: string
          rejection_reason?: string | null
          start_date: string
          start_time?: string | null
          status?: string
          type_id: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          end_date?: string
          end_time?: string | null
          first_day?: string
          id?: string
          last_day?: string
          note?: string | null
          profile_id?: string
          rejection_reason?: string | null
          start_date?: string
          start_time?: string | null
          status?: string
          type_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "absences_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "absences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "absences_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "absences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "absences_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "absence_types"
            referencedColumns: ["id"]
          },
        ]
      }
      account_invites: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          name: string | null
          role: Database["public"]["Enums"]["user_role"]
          team: Database["public"]["Enums"]["team"]
          used_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          name?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          team: Database["public"]["Enums"]["team"]
          used_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          name?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          team?: Database["public"]["Enums"]["team"]
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      box_types: {
        Row: {
          created_at: string
          empty_weight_kg: number
          height_cm: number | null
          id: string
          is_active: boolean
          length_cm: number | null
          name: string
          sort_order: number
          updated_at: string
          width_cm: number | null
        }
        Insert: {
          created_at?: string
          empty_weight_kg: number
          height_cm?: number | null
          id?: string
          is_active?: boolean
          length_cm?: number | null
          name: string
          sort_order?: number
          updated_at?: string
          width_cm?: number | null
        }
        Update: {
          created_at?: string
          empty_weight_kg?: number
          height_cm?: number | null
          id?: string
          is_active?: boolean
          length_cm?: number | null
          name?: string
          sort_order?: number
          updated_at?: string
          width_cm?: number | null
        }
        Relationships: []
      }
      brands: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      collection_agencies: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      collection_cases: {
        Row: {
          agency_id: string | null
          agency_reference: string | null
          agency_sent_on: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          next_follow_up: string | null
          note: string | null
          promised_on: string | null
          reminders_sent: number
          responsible_id: string | null
          stage: string
          updated_at: string
        }
        Insert: {
          agency_id?: string | null
          agency_reference?: string | null
          agency_sent_on?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          next_follow_up?: string | null
          note?: string | null
          promised_on?: string | null
          reminders_sent?: number
          responsible_id?: string | null
          stage?: string
          updated_at?: string
        }
        Update: {
          agency_id?: string | null
          agency_reference?: string | null
          agency_sent_on?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          next_follow_up?: string | null
          note?: string | null
          promised_on?: string | null
          reminders_sent?: number
          responsible_id?: string | null
          stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_cases_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "collection_agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_cases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_cases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_cases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "collection_cases_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_events: {
        Row: {
          body: string | null
          case_id: string
          created_at: string
          created_by: string | null
          detail: Json
          happened_on: string
          id: number
          kind: string
        }
        Insert: {
          body?: string | null
          case_id: string
          created_at?: string
          created_by?: string | null
          detail?: Json
          happened_on?: string
          id?: number
          kind: string
        }
        Update: {
          body?: string | null
          case_id?: string
          created_at?: string
          created_by?: string | null
          detail?: Json
          happened_on?: string
          id?: number
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "collection_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_invoices: {
        Row: {
          amount: number
          case_id: string
          created_at: string
          due_date: string | null
          id: string
          invoice_number: string
        }
        Insert: {
          amount: number
          case_id: string
          created_at?: string
          due_date?: string | null
          id?: string
          invoice_number: string
        }
        Update: {
          amount?: number
          case_id?: string
          created_at?: string
          due_date?: string | null
          id?: string
          invoice_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_invoices_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "collection_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_notices: {
        Row: {
          case_id: string
          kind: string
          on_date: string
          sent_at: string
        }
        Insert: {
          case_id: string
          kind: string
          on_date: string
          sent_at?: string
        }
        Update: {
          case_id?: string
          kind?: string
          on_date?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_notices_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "collection_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_payments: {
        Row: {
          amount: number
          case_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          paid_on: string
          via_agency: boolean
        }
        Insert: {
          amount: number
          case_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          paid_on: string
          via_agency?: boolean
        }
        Update: {
          amount?: number
          case_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          paid_on?: string
          via_agency?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "collection_payments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "collection_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_team: {
        Row: {
          added_by: string | null
          created_at: string
          profile_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          profile_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_team_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_team_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_assignments: {
        Row: {
          absence_id: string
          cover_date: string
          coverer_id: string
          created_at: string
          created_by: string | null
          end_time: string
          id: string
          note: string | null
          removed_at: string | null
          removed_by: string | null
          start_time: string
          updated_at: string
        }
        Insert: {
          absence_id: string
          cover_date: string
          coverer_id: string
          created_at?: string
          created_by?: string | null
          end_time: string
          id?: string
          note?: string | null
          removed_at?: string | null
          removed_by?: string | null
          start_time: string
          updated_at?: string
        }
        Update: {
          absence_id?: string
          cover_date?: string
          coverer_id?: string
          created_at?: string
          created_by?: string | null
          end_time?: string
          id?: string
          note?: string | null
          removed_at?: string | null
          removed_by?: string | null
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_assignments_absence_id_fkey"
            columns: ["absence_id"]
            isOneToOne: false
            referencedRelation: "absences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_assignments_coverer_id_fkey"
            columns: ["coverer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_assignments_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_events: {
        Row: {
          absence_id: string
          action: string
          actor_id: string | null
          assignment_id: string
          created_at: string
          detail: Json
          id: number
        }
        Insert: {
          absence_id: string
          action: string
          actor_id?: string | null
          assignment_id: string
          created_at?: string
          detail?: Json
          id?: number
        }
        Update: {
          absence_id?: string
          action?: string
          actor_id?: string | null
          assignment_id?: string
          created_at?: string
          detail?: Json
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "coverage_events_absence_id_fkey"
            columns: ["absence_id"]
            isOneToOne: false
            referencedRelation: "absences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_events_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "coverage_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_notices: {
        Row: {
          assignment_id: string
          kind: string
          sent_at: string
        }
        Insert: {
          assignment_id: string
          kind: string
          sent_at?: string
        }
        Update: {
          assignment_id?: string
          kind?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_notices_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "coverage_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_permission_grants: {
        Row: {
          assignment_id: string
          created_at: string
          granted_by: string | null
          id: string
          permission: string
          revoked_at: string | null
          revoked_by: string | null
        }
        Insert: {
          assignment_id: string
          created_at?: string
          granted_by?: string | null
          id?: string
          permission: string
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Update: {
          assignment_id?: string
          created_at?: string
          granted_by?: string | null
          id?: string
          permission?: string
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coverage_permission_grants_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "coverage_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_permission_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_permission_grants_permission_fkey"
            columns: ["permission"]
            isOneToOne: false
            referencedRelation: "permission_catalog"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "coverage_permission_grants_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_notes: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          kind_id: string
          note_date: string
          starred: boolean
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          kind_id: string
          note_date: string
          starred?: boolean
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          kind_id?: string
          note_date?: string
          starred?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "customer_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_notes_kind_id_fkey"
            columns: ["kind_id"]
            isOneToOne: false
            referencedRelation: "sales_activity_kinds"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_specification_types: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      customer_specifications: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          is_active: boolean
          type_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          is_active?: boolean
          type_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          is_active?: boolean
          type_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_specifications_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_specifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_specifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_specifications_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "customer_specification_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_specifications_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_types: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          address_checked_at: string | null
          address_checked_by: string | null
          city: string | null
          company_name: string
          company_name_addition: string | null
          country: string
          created_at: string
          customer_type_id: string | null
          delivery_notes: string | null
          geocoded_at: string | null
          id: string
          is_active: boolean
          latitude: number | null
          location_precision: string | null
          longitude: number | null
          name: string | null
          postal_code: string | null
          prepay_required: boolean
          prepay_since: string | null
          street: string | null
          updated_at: string
        }
        Insert: {
          address_checked_at?: string | null
          address_checked_by?: string | null
          city?: string | null
          company_name: string
          company_name_addition?: string | null
          country?: string
          created_at?: string
          customer_type_id?: string | null
          delivery_notes?: string | null
          geocoded_at?: string | null
          id?: string
          is_active?: boolean
          latitude?: number | null
          location_precision?: string | null
          longitude?: number | null
          name?: string | null
          postal_code?: string | null
          prepay_required?: boolean
          prepay_since?: string | null
          street?: string | null
          updated_at?: string
        }
        Update: {
          address_checked_at?: string | null
          address_checked_by?: string | null
          city?: string | null
          company_name?: string
          company_name_addition?: string | null
          country?: string
          created_at?: string
          customer_type_id?: string | null
          delivery_notes?: string | null
          geocoded_at?: string | null
          id?: string
          is_active?: boolean
          latitude?: number | null
          location_precision?: string | null
          longitude?: number | null
          name?: string | null
          postal_code?: string | null
          prepay_required?: boolean
          prepay_since?: string | null
          street?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_address_checked_by_fkey"
            columns: ["address_checked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_customer_type_id_fkey"
            columns: ["customer_type_id"]
            isOneToOne: false
            referencedRelation: "customer_types"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_methods: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          own_vehicle: boolean
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          own_vehicle?: boolean
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          own_vehicle?: boolean
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      equipment: {
        Row: {
          brand: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          location: string | null
          model: string | null
          name: string
          notes: string | null
          serial_number: string | null
          service_contact: string | null
          service_email: string | null
          service_phone: string | null
          updated_at: string
        }
        Insert: {
          brand?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          model?: string | null
          name: string
          notes?: string | null
          serial_number?: string | null
          service_contact?: string | null
          service_email?: string | null
          service_phone?: string | null
          updated_at?: string
        }
        Update: {
          brand?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          model?: string | null
          name?: string
          notes?: string | null
          serial_number?: string | null
          service_contact?: string | null
          service_email?: string | null
          service_phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_cost_types: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          translations: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          translations?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          translations?: Json
          updated_at?: string
        }
        Relationships: []
      }
      event_costs: {
        Row: {
          actual_amount: number | null
          created_at: string
          description: string | null
          event_id: string
          id: string
          planned_amount: number | null
          type_id: string
        }
        Insert: {
          actual_amount?: number | null
          created_at?: string
          description?: string | null
          event_id: string
          id?: string
          planned_amount?: number | null
          type_id: string
        }
        Update: {
          actual_amount?: number | null
          created_at?: string
          description?: string | null
          event_id?: string
          id?: string
          planned_amount?: number | null
          type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_costs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_costs_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "event_cost_types"
            referencedColumns: ["id"]
          },
        ]
      }
      event_files: {
        Row: {
          created_at: string
          event_id: string
          file_name: string
          id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          file_name: string
          id?: string
          mime_type: string
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          file_name?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_files_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_kind_tasks: {
        Row: {
          anchor: string
          days: number
          id: string
          kind_id: string
          sort_order: number
          title: string
          translations: Json
        }
        Insert: {
          anchor?: string
          days?: number
          id?: string
          kind_id: string
          sort_order?: number
          title: string
          translations?: Json
        }
        Update: {
          anchor?: string
          days?: number
          id?: string
          kind_id?: string
          sort_order?: number
          title?: string
          translations?: Json
        }
        Relationships: [
          {
            foreignKeyName: "event_kind_tasks_kind_id_fkey"
            columns: ["kind_id"]
            isOneToOne: false
            referencedRelation: "event_kinds"
            referencedColumns: ["id"]
          },
        ]
      }
      event_kinds: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          translations: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          translations?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          translations?: Json
          updated_at?: string
        }
        Relationships: []
      }
      event_notes: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          event_id: string
          id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          event_id: string
          id?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          event_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_notes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_products: {
        Row: {
          event_id: string
          id: string
          note: string | null
          position: number
          product_id: string
          quantity: number
        }
        Insert: {
          event_id: string
          id?: string
          note?: string | null
          position?: number
          product_id: string
          quantity: number
        }
        Update: {
          event_id?: string
          id?: string
          note?: string | null
          position?: number
          product_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_products_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "event_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      event_returns: {
        Row: {
          back_quantity: number
          discarded_quantity: number
          event_id: string
          product_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          back_quantity?: number
          discarded_quantity?: number
          event_id: string
          product_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          back_quantity?: number
          discarded_quantity?: number
          event_id?: string
          product_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_returns_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_returns_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "event_returns_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_returns_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_shifts: {
        Row: {
          created_at: string
          end_time: string | null
          event_id: string
          hr_worker_id: string | null
          id: string
          note: string | null
          profile_id: string | null
          shift_date: string
          start_time: string | null
        }
        Insert: {
          created_at?: string
          end_time?: string | null
          event_id: string
          hr_worker_id?: string | null
          id?: string
          note?: string | null
          profile_id?: string | null
          shift_date: string
          start_time?: string | null
        }
        Update: {
          created_at?: string
          end_time?: string | null
          event_id?: string
          hr_worker_id?: string | null
          id?: string
          note?: string | null
          profile_id?: string | null
          shift_date?: string
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_shifts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_shifts_hr_worker_id_fkey"
            columns: ["hr_worker_id"]
            isOneToOne: false
            referencedRelation: "hr_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_shifts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          cancel_reason: string | null
          city: string | null
          close_time: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          delivery_date: string | null
          delivery_method_id: string | null
          description: string | null
          end_date: string
          id: string
          kind_id: string
          latitude: number | null
          longitude: number | null
          name: string
          open_time: string | null
          order_id: string | null
          owner_id: string | null
          place_name: string | null
          postal_code: string | null
          result_contacts: number | null
          result_rating: number | null
          result_repeat: string | null
          result_samples: number | null
          result_summary: string | null
          result_visitors: number | null
          stage: string
          start_date: string
          street: string | null
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          city?: string | null
          close_time?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivery_date?: string | null
          delivery_method_id?: string | null
          description?: string | null
          end_date: string
          id?: string
          kind_id: string
          latitude?: number | null
          longitude?: number | null
          name: string
          open_time?: string | null
          order_id?: string | null
          owner_id?: string | null
          place_name?: string | null
          postal_code?: string | null
          result_contacts?: number | null
          result_rating?: number | null
          result_repeat?: string | null
          result_samples?: number | null
          result_summary?: string | null
          result_visitors?: number | null
          stage?: string
          start_date: string
          street?: string | null
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          city?: string | null
          close_time?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivery_date?: string | null
          delivery_method_id?: string | null
          description?: string | null
          end_date?: string
          id?: string
          kind_id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          open_time?: string | null
          order_id?: string | null
          owner_id?: string | null
          place_name?: string | null
          postal_code?: string | null
          result_contacts?: number | null
          result_rating?: number | null
          result_repeat?: string | null
          result_samples?: number | null
          result_summary?: string | null
          result_visitors?: number | null
          stage?: string
          start_date?: string
          street?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "events_delivery_method_id_fkey"
            columns: ["delivery_method_id"]
            isOneToOne: false
            referencedRelation: "delivery_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_kind_id_fkey"
            columns: ["kind_id"]
            isOneToOne: false
            referencedRelation: "event_kinds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_reception_assignees: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_reception_assignees_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_reception_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_reception_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          new_value: Json | null
          previous_value: Json | null
          reception_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_value?: Json | null
          previous_value?: Json | null
          reception_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_value?: Json | null
          previous_value?: Json | null
          reception_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_reception_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_reception_audit_log_reception_id_fkey"
            columns: ["reception_id"]
            isOneToOne: false
            referencedRelation: "goods_receptions"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_reception_evidence: {
        Row: {
          created_at: string
          exception_id: string | null
          file_name: string
          id: string
          mime_type: string
          reception_id: string
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          exception_id?: string | null
          file_name: string
          id?: string
          mime_type: string
          reception_id: string
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          exception_id?: string | null
          file_name?: string
          id?: string
          mime_type?: string
          reception_id?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_reception_evidence_exception_id_fkey"
            columns: ["exception_id"]
            isOneToOne: false
            referencedRelation: "goods_reception_exceptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_reception_evidence_reception_id_fkey"
            columns: ["reception_id"]
            isOneToOne: false
            referencedRelation: "goods_receptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_reception_evidence_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_reception_exceptions: {
        Row: {
          affected_quantity: number | null
          best_before: string | null
          created_at: string
          created_by: string | null
          description: string
          id: string
          lot_number: string | null
          product_id: string
          reception_id: string
          updated_at: string
        }
        Insert: {
          affected_quantity?: number | null
          best_before?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          lot_number?: string | null
          product_id: string
          reception_id: string
          updated_at?: string
        }
        Update: {
          affected_quantity?: number | null
          best_before?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          lot_number?: string | null
          product_id?: string
          reception_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_reception_exceptions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_reception_exceptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "goods_reception_exceptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_reception_exceptions_reception_id_fkey"
            columns: ["reception_id"]
            isOneToOne: false
            referencedRelation: "goods_receptions"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_reception_report_snapshots: {
        Row: {
          generated_at: string
          generated_by: string | null
          id: string
          note: string | null
          payload: Json
          period_month: string
          reception_ids: string[]
          version: number
        }
        Insert: {
          generated_at?: string
          generated_by?: string | null
          id?: string
          note?: string | null
          payload: Json
          period_month: string
          reception_ids?: string[]
          version: number
        }
        Update: {
          generated_at?: string
          generated_by?: string | null
          id?: string
          note?: string | null
          payload?: Json
          period_month?: string
          reception_ids?: string[]
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "goods_reception_report_snapshots_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receptions: {
        Row: {
          comments: string | null
          completed_at: string | null
          completed_by: string | null
          condition:
            | Database["public"]["Enums"]["goods_reception_condition"]
            | null
          created_at: string
          created_by: string | null
          delivery_note: string | null
          id: string
          quantity_check: Database["public"]["Enums"]["goods_reception_quantity_check"]
          received_at: string
          received_by: string
          reception_number: string
          reference: number
          status: Database["public"]["Enums"]["goods_reception_status"]
          supplier_id: string | null
          transporter_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          comments?: string | null
          completed_at?: string | null
          completed_by?: string | null
          condition?:
            | Database["public"]["Enums"]["goods_reception_condition"]
            | null
          created_at?: string
          created_by?: string | null
          delivery_note?: string | null
          id?: string
          quantity_check?: Database["public"]["Enums"]["goods_reception_quantity_check"]
          received_at?: string
          received_by: string
          reception_number: string
          reference?: never
          status?: Database["public"]["Enums"]["goods_reception_status"]
          supplier_id?: string | null
          transporter_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          comments?: string | null
          completed_at?: string | null
          completed_by?: string | null
          condition?:
            | Database["public"]["Enums"]["goods_reception_condition"]
            | null
          created_at?: string
          created_by?: string | null
          delivery_note?: string | null
          id?: string
          quantity_check?: Database["public"]["Enums"]["goods_reception_quantity_check"]
          received_at?: string
          received_by?: string
          reception_number?: string
          reference?: never
          status?: Database["public"]["Enums"]["goods_reception_status"]
          supplier_id?: string | null
          transporter_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_receptions_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receptions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receptions_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receptions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receptions_transporter_id_fkey"
            columns: ["transporter_id"]
            isOneToOne: false
            referencedRelation: "transporters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receptions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      handover_events: {
        Row: {
          absence_id: string
          action: string
          actor_id: string | null
          created_at: string
          detail: Json
          id: number
          item_id: string | null
        }
        Insert: {
          absence_id: string
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: number
          item_id?: string | null
        }
        Update: {
          absence_id?: string
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: number
          item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "handover_events_absence_id_fkey"
            columns: ["absence_id"]
            isOneToOne: false
            referencedRelation: "absences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "handover_items"
            referencedColumns: ["id"]
          },
        ]
      }
      handover_items: {
        Row: {
          absence_id: string
          body: string | null
          coverer_note: string | null
          created_at: string
          created_by: string | null
          id: string
          link_id: string | null
          link_label: string | null
          link_type: string | null
          removed_at: string | null
          sort_order: number
          status: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          absence_id: string
          body?: string | null
          coverer_note?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          link_id?: string | null
          link_label?: string | null
          link_type?: string | null
          removed_at?: string | null
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          absence_id?: string
          body?: string | null
          coverer_note?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          link_id?: string | null
          link_label?: string | null
          link_type?: string | null
          removed_at?: string | null
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "handover_items_absence_id_fkey"
            columns: ["absence_id"]
            isOneToOne: false
            referencedRelation: "absences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_items_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      handover_sends: {
        Row: {
          absence_id: string
          id: number
          recipients: number
          sent_at: string
          sent_by: string | null
        }
        Insert: {
          absence_id: string
          id?: number
          recipients?: number
          sent_at?: string
          sent_by?: string | null
        }
        Update: {
          absence_id?: string
          id?: number
          recipients?: number
          sent_at?: string
          sent_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "handover_sends_absence_id_fkey"
            columns: ["absence_id"]
            isOneToOne: false
            referencedRelation: "absences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_sends_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_celebration_notices: {
        Row: {
          kind: string
          on_date: string
          sent_at: string
          stage: string
          worker_id: string
        }
        Insert: {
          kind: string
          on_date: string
          sent_at?: string
          stage: string
          worker_id: string
        }
        Update: {
          kind?: string
          on_date?: string
          sent_at?: string
          stage?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_celebration_notices_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "hr_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_criteria: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          team: Database["public"]["Enums"]["team"]
          template_id: string | null
          translations: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          team: Database["public"]["Enums"]["team"]
          template_id?: string | null
          translations?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          team?: Database["public"]["Enums"]["team"]
          template_id?: string | null
          translations?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_criteria_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "hr_eval_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_eval_answers: {
        Row: {
          assignment_id: string
          body: string | null
          item_id: string
          score: number | null
        }
        Insert: {
          assignment_id: string
          body?: string | null
          item_id: string
          score?: number | null
        }
        Update: {
          assignment_id?: string
          body?: string | null
          item_id?: string
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_eval_answers_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "hr_eval_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_eval_answers_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "hr_eval_request_items"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_eval_assignments: {
        Row: {
          comment: string | null
          created_at: string
          evaluator_id: string | null
          id: string
          reminded_at: string | null
          request_id: string
          submitted_at: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          evaluator_id?: string | null
          id?: string
          reminded_at?: string | null
          request_id: string
          submitted_at?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          evaluator_id?: string | null
          id?: string
          reminded_at?: string | null
          request_id?: string
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_eval_assignments_evaluator_id_fkey"
            columns: ["evaluator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_eval_assignments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "hr_eval_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_eval_request_items: {
        Row: {
          criterion_id: string | null
          description: string | null
          id: string
          kind: string
          name: string
          request_id: string
          sort_order: number
          translations: Json
        }
        Insert: {
          criterion_id?: string | null
          description?: string | null
          id?: string
          kind: string
          name: string
          request_id: string
          sort_order: number
          translations?: Json
        }
        Update: {
          criterion_id?: string | null
          description?: string | null
          id?: string
          kind?: string
          name?: string
          request_id?: string
          sort_order?: number
          translations?: Json
        }
        Relationships: [
          {
            foreignKeyName: "hr_eval_request_items_criterion_id_fkey"
            columns: ["criterion_id"]
            isOneToOne: false
            referencedRelation: "hr_criteria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_eval_request_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "hr_eval_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_eval_requests: {
        Row: {
          closed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string
          id: string
          worker_id: string
          worker_name: string
          worker_position: string | null
          worker_team: Database["public"]["Enums"]["team"]
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          deadline: string
          id?: string
          worker_id: string
          worker_name: string
          worker_position?: string | null
          worker_team: Database["public"]["Enums"]["team"]
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          deadline?: string
          id?: string
          worker_id?: string
          worker_name?: string
          worker_position?: string | null
          worker_team?: Database["public"]["Enums"]["team"]
        }
        Relationships: [
          {
            foreignKeyName: "hr_eval_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_eval_requests_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "hr_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_eval_templates: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          team: Database["public"]["Enums"]["team"]
          translations: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          team: Database["public"]["Enums"]["team"]
          translations?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          team?: Database["public"]["Enums"]["team"]
          translations?: Json
          updated_at?: string
        }
        Relationships: []
      }
      hr_evaluation_scores: {
        Row: {
          comment: string | null
          criterion_id: string | null
          criterion_name: string
          criterion_translations: Json
          evaluation_id: string
          score: number
          sort_order: number
        }
        Insert: {
          comment?: string | null
          criterion_id?: string | null
          criterion_name: string
          criterion_translations?: Json
          evaluation_id: string
          score: number
          sort_order?: number
        }
        Update: {
          comment?: string | null
          criterion_id?: string | null
          criterion_name?: string
          criterion_translations?: Json
          evaluation_id?: string
          score?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "hr_evaluation_scores_criterion_id_fkey"
            columns: ["criterion_id"]
            isOneToOne: false
            referencedRelation: "hr_criteria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_evaluation_scores_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "hr_evaluations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_evaluations: {
        Row: {
          comment: string | null
          created_at: string
          created_by: string | null
          evaluated_on: string
          goals: string | null
          id: string
          worker_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          created_by?: string | null
          evaluated_on: string
          goals?: string | null
          id?: string
          worker_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          created_by?: string | null
          evaluated_on?: string
          goals?: string | null
          id?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_evaluations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_evaluations_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "hr_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_late_arrivals: {
        Row: {
          arrival_date: string
          arrived_time: string
          created_at: string
          created_by: string | null
          excused: boolean
          expected_time: string
          id: string
          kind: string | null
          minutes_late: number | null
          minutes_off: number | null
          note: string | null
          notified: boolean
          reason_id: string | null
          updated_at: string
          worker_id: string
        }
        Insert: {
          arrival_date: string
          arrived_time: string
          created_at?: string
          created_by?: string | null
          excused?: boolean
          expected_time: string
          id?: string
          kind?: string | null
          minutes_late?: number | null
          minutes_off?: number | null
          note?: string | null
          notified?: boolean
          reason_id?: string | null
          updated_at?: string
          worker_id: string
        }
        Update: {
          arrival_date?: string
          arrived_time?: string
          created_at?: string
          created_by?: string | null
          excused?: boolean
          expected_time?: string
          id?: string
          kind?: string | null
          minutes_late?: number | null
          minutes_off?: number | null
          note?: string | null
          notified?: boolean
          reason_id?: string | null
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_late_arrivals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_late_arrivals_reason_id_fkey"
            columns: ["reason_id"]
            isOneToOne: false
            referencedRelation: "hr_late_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_late_arrivals_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "hr_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_late_reasons: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          translations: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          translations?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          translations?: Json
          updated_at?: string
        }
        Relationships: []
      }
      hr_note_attachments: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string
          note_id: string
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime_type: string
          note_id: string
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string
          note_id?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_note_attachments_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "hr_note_follow_up_state"
            referencedColumns: ["note_id"]
          },
          {
            foreignKeyName: "hr_note_attachments_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "hr_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_note_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_note_followups: {
        Row: {
          body: string | null
          closes: boolean
          created_at: string
          created_by: string | null
          entry_date: string
          id: string
          kind: string
          next_on: string | null
          next_text: string | null
          no_follow_up_reason: string | null
          note_id: string
          sections: Json | null
          warning_level: string | null
        }
        Insert: {
          body?: string | null
          closes?: boolean
          created_at?: string
          created_by?: string | null
          entry_date: string
          id?: string
          kind: string
          next_on?: string | null
          next_text?: string | null
          no_follow_up_reason?: string | null
          note_id: string
          sections?: Json | null
          warning_level?: string | null
        }
        Update: {
          body?: string | null
          closes?: boolean
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          kind?: string
          next_on?: string | null
          next_text?: string | null
          no_follow_up_reason?: string | null
          note_id?: string
          sections?: Json | null
          warning_level?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_note_followups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_note_followups_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "hr_note_follow_up_state"
            referencedColumns: ["note_id"]
          },
          {
            foreignKeyName: "hr_note_followups_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "hr_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_note_participants: {
        Row: {
          followup_id: string | null
          id: string
          name: string
          note_id: string
          profile_id: string | null
          worker_id: string | null
        }
        Insert: {
          followup_id?: string | null
          id?: string
          name: string
          note_id: string
          profile_id?: string | null
          worker_id?: string | null
        }
        Update: {
          followup_id?: string | null
          id?: string
          name?: string
          note_id?: string
          profile_id?: string | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_note_participants_followup_id_fkey"
            columns: ["followup_id"]
            isOneToOne: false
            referencedRelation: "hr_note_followups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_note_participants_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "hr_note_follow_up_state"
            referencedColumns: ["note_id"]
          },
          {
            foreignKeyName: "hr_note_participants_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "hr_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_note_participants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_note_participants_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "hr_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_note_types: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          structure: string
          translations: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          structure?: string
          translations?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          structure?: string
          translations?: Json
          updated_at?: string
        }
        Relationships: []
      }
      hr_notes: {
        Row: {
          body: string | null
          created_at: string
          created_by: string | null
          follow_up_on: string | null
          follow_up_text: string | null
          id: string
          no_follow_up_reason: string | null
          note_date: string
          sections: Json | null
          type_id: string
          warning_level: string | null
          worker_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          follow_up_on?: string | null
          follow_up_text?: string | null
          id?: string
          no_follow_up_reason?: string | null
          note_date: string
          sections?: Json | null
          type_id: string
          warning_level?: string | null
          worker_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          follow_up_on?: string | null
          follow_up_text?: string | null
          id?: string
          no_follow_up_reason?: string | null
          note_date?: string
          sections?: Json | null
          type_id?: string
          warning_level?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_notes_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "hr_note_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_notes_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "hr_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_workers: {
        Row: {
          address: string | null
          birth_date: string | null
          created_at: string
          created_by: string | null
          email: string | null
          emergency_contact: string | null
          id: string
          is_active: boolean
          left_on: string | null
          name: string
          phone: string | null
          position: string | null
          profile_id: string | null
          start_date: string | null
          team: Database["public"]["Enums"]["team"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          birth_date?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          emergency_contact?: string | null
          id?: string
          is_active?: boolean
          left_on?: string | null
          name: string
          phone?: string | null
          position?: string | null
          profile_id?: string | null
          start_date?: string | null
          team: Database["public"]["Enums"]["team"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          birth_date?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          emergency_contact?: string | null
          id?: string
          is_active?: boolean
          left_on?: string | null
          name?: string
          phone?: string | null
          position?: string | null
          profile_id?: string | null
          start_date?: string | null
          team?: Database["public"]["Enums"]["team"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_workers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_workers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_affected_items: {
        Row: {
          affected_quantity: number | null
          created_at: string
          id: string
          incident_id: string
          lot_allocation_id: string | null
          note: string | null
          order_line_id: string | null
          position: number
          product_id: string
        }
        Insert: {
          affected_quantity?: number | null
          created_at?: string
          id?: string
          incident_id: string
          lot_allocation_id?: string | null
          note?: string | null
          order_line_id?: string | null
          position?: number
          product_id: string
        }
        Update: {
          affected_quantity?: number | null
          created_at?: string
          id?: string
          incident_id?: string
          lot_allocation_id?: string | null
          note?: string | null
          order_line_id?: string | null
          position?: number
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_affected_items_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_affected_items_lot_allocation_id_fkey"
            columns: ["lot_allocation_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_affected_items_lot_allocation_id_fkey"
            columns: ["lot_allocation_id"]
            isOneToOne: false
            referencedRelation: "lot_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_affected_items_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["order_line_id"]
          },
          {
            foreignKeyName: "incident_affected_items_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_affected_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "incident_affected_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          incident_id: string | null
          new_value: Json | null
          previous_value: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          incident_id?: string | null
          new_value?: Json | null
          previous_value?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          incident_id?: string | null
          new_value?: Json | null
          previous_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_audit_log_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      incident_evidence: {
        Row: {
          created_at: string
          file_name: string
          id: string
          incident_id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          incident_id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          incident_id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_evidence_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_evidence_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_replacements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          incident_id: string
          note: string | null
          order_id: string | null
          product_id: string | null
          quantity: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          incident_id: string
          note?: string | null
          order_id?: string | null
          product_id?: string | null
          quantity?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          incident_id?: string
          note?: string | null
          order_id?: string | null
          product_id?: string | null
          quantity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_replacements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_replacements_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_replacements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "incident_replacements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_replacements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "incident_replacements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_report_snapshots: {
        Row: {
          generated_at: string
          generated_by: string | null
          id: string
          incident_ids: string[]
          note: string | null
          payload: Json
          period_month: string
          version: number
        }
        Insert: {
          generated_at?: string
          generated_by?: string | null
          id?: string
          incident_ids?: string[]
          note?: string | null
          payload: Json
          period_month: string
          version: number
        }
        Update: {
          generated_at?: string
          generated_by?: string | null
          id?: string
          incident_ids?: string[]
          note?: string | null
          payload?: Json
          period_month?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "incident_report_snapshots_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_secondary_causes: {
        Row: {
          cause: Database["public"]["Enums"]["incident_cause"]
          incident_id: string
        }
        Insert: {
          cause: Database["public"]["Enums"]["incident_cause"]
          incident_id: string
        }
        Update: {
          cause?: Database["public"]["Enums"]["incident_cause"]
          incident_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_secondary_causes_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_types: {
        Row: {
          category_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_types_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "incident_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          delivery_method_id: string | null
          description: string
          detected_at: string
          goods_reception_id: string | null
          id: string
          incident_number: string
          incident_type_id: string
          investigation_notes: string | null
          order_id: string | null
          primary_cause: Database["public"]["Enums"]["incident_cause"] | null
          reference: number
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          responsibility: Database["public"]["Enums"]["incident_responsibility"]
          severity: Database["public"]["Enums"]["incident_severity"]
          status: Database["public"]["Enums"]["incident_status"]
          team: Database["public"]["Enums"]["team"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivery_method_id?: string | null
          description: string
          detected_at?: string
          goods_reception_id?: string | null
          id?: string
          incident_number: string
          incident_type_id: string
          investigation_notes?: string | null
          order_id?: string | null
          primary_cause?: Database["public"]["Enums"]["incident_cause"] | null
          reference?: never
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          responsibility?: Database["public"]["Enums"]["incident_responsibility"]
          severity?: Database["public"]["Enums"]["incident_severity"]
          status?: Database["public"]["Enums"]["incident_status"]
          team: Database["public"]["Enums"]["team"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivery_method_id?: string | null
          description?: string
          detected_at?: string
          goods_reception_id?: string | null
          id?: string
          incident_number?: string
          incident_type_id?: string
          investigation_notes?: string | null
          order_id?: string | null
          primary_cause?: Database["public"]["Enums"]["incident_cause"] | null
          reference?: never
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          responsibility?: Database["public"]["Enums"]["incident_responsibility"]
          severity?: Database["public"]["Enums"]["incident_severity"]
          status?: Database["public"]["Enums"]["incident_status"]
          team?: Database["public"]["Enums"]["team"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incidents_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "incidents_delivery_method_id_fkey"
            columns: ["delivery_method_id"]
            isOneToOne: false
            referencedRelation: "delivery_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_goods_reception_id_fkey"
            columns: ["goods_reception_id"]
            isOneToOne: false
            referencedRelation: "goods_receptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_incident_type_id_fkey"
            columns: ["incident_type_id"]
            isOneToOne: false
            referencedRelation: "incident_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "incidents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          instance_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          instance_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          instance_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_assignments_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "inventory_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entry_id: string | null
          id: string
          instance_id: string | null
          instance_item_id: string | null
          new_value: Json | null
          previous_value: Json | null
          template_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entry_id?: string | null
          id?: string
          instance_id?: string | null
          instance_item_id?: string | null
          new_value?: Json | null
          previous_value?: Json | null
          template_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entry_id?: string | null
          id?: string
          instance_id?: string | null
          instance_item_id?: string | null
          new_value?: Json | null
          previous_value?: Json | null
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_audit_log_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "inventory_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_audit_log_instance_item_id_fkey"
            columns: ["instance_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_instance_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_audit_log_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "inventory_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          instance_id: string
          instance_item_id: string | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          instance_id: string
          instance_item_id?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          instance_id?: string
          instance_item_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_comments_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "inventory_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_comments_instance_item_id_fkey"
            columns: ["instance_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_instance_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_digital_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          instance_id: string
          instance_item_id: string
          new_difference: number | null
          new_digital: number | null
          physical_stock_at: number
          previous_difference: number | null
          previous_digital: number | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          instance_id: string
          instance_item_id: string
          new_difference?: number | null
          new_digital?: number | null
          physical_stock_at: number
          previous_difference?: number | null
          previous_digital?: number | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          instance_id?: string
          instance_item_id?: string
          new_difference?: number | null
          new_digital?: number | null
          physical_stock_at?: number
          previous_difference?: number | null
          previous_digital?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_digital_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_digital_history_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "inventory_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_digital_history_instance_item_id_fkey"
            columns: ["instance_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_instance_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_edit_grants: {
        Row: {
          created_at: string
          ends_at: string
          granted_by: string | null
          id: string
          instance_id: string | null
          reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          scope: Database["public"]["Enums"]["inventory_grant_scope"]
          starts_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          granted_by?: string | null
          id?: string
          instance_id?: string | null
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          scope: Database["public"]["Enums"]["inventory_grant_scope"]
          starts_at: string
          user_id: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          granted_by?: string | null
          id?: string
          instance_id?: string | null
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          scope?: Database["public"]["Enums"]["inventory_grant_scope"]
          starts_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_edit_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_edit_grants_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "inventory_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_edit_grants_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_edit_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_entries: {
        Row: {
          created_at: string
          created_by: string | null
          expiry_date: string | null
          id: string
          instance_id: string
          instance_item_id: string
          location_id: string | null
          location_name: string | null
          lot_number: string | null
          note: string | null
          position: number
          quantity: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expiry_date?: string | null
          id?: string
          instance_id: string
          instance_item_id: string
          location_id?: string | null
          location_name?: string | null
          lot_number?: string | null
          note?: string | null
          position?: number
          quantity?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expiry_date?: string | null
          id?: string
          instance_id?: string
          instance_item_id?: string
          location_id?: string | null
          location_name?: string | null
          lot_number?: string | null
          note?: string | null
          position?: number
          quantity?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_entries_item_fk"
            columns: ["instance_item_id", "instance_id"]
            isOneToOne: false
            referencedRelation: "inventory_instance_items"
            referencedColumns: ["id", "instance_id"]
          },
          {
            foreignKeyName: "inventory_entries_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_entries_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_instance_items: {
        Row: {
          counted_at: string | null
          counted_by: string | null
          created_at: string
          difference: number | null
          digital_quantity: number | null
          id: string
          instance_id: string
          is_resolved: boolean
          item_group: string | null
          item_name: string
          item_sort_order: number
          item_translations: Json
          physical_stock: number
          product_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["inventory_status"]
          template_item_id: string
          updated_at: string
        }
        Insert: {
          counted_at?: string | null
          counted_by?: string | null
          created_at?: string
          difference?: number | null
          digital_quantity?: number | null
          id?: string
          instance_id: string
          is_resolved?: boolean
          item_group?: string | null
          item_name: string
          item_sort_order?: number
          item_translations?: Json
          physical_stock?: number
          product_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["inventory_status"]
          template_item_id: string
          updated_at?: string
        }
        Update: {
          counted_at?: string | null
          counted_by?: string | null
          created_at?: string
          difference?: number | null
          digital_quantity?: number | null
          id?: string
          instance_id?: string
          is_resolved?: boolean
          item_group?: string | null
          item_name?: string
          item_sort_order?: number
          item_translations?: Json
          physical_stock?: number
          product_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["inventory_status"]
          template_item_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_instance_items_counted_by_fkey"
            columns: ["counted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_instance_items_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "inventory_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_instance_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_instance_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_instance_items_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_instance_items_template_item_id_fkey"
            columns: ["template_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_template_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_instances: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          digital_enabled: boolean
          id: string
          inventory_date: string
          iso_week: number | null
          iso_year: number | null
          kind: Database["public"]["Enums"]["inventory_kind"]
          name_snapshot: string
          period_key: string
          source: Database["public"]["Enums"]["schedule_source"]
          status: Database["public"]["Enums"]["inventory_status"]
          template_id: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          digital_enabled: boolean
          id?: string
          inventory_date: string
          iso_week?: number | null
          iso_year?: number | null
          kind: Database["public"]["Enums"]["inventory_kind"]
          name_snapshot: string
          period_key: string
          source?: Database["public"]["Enums"]["schedule_source"]
          status?: Database["public"]["Enums"]["inventory_status"]
          template_id: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          digital_enabled?: boolean
          id?: string
          inventory_date?: string
          iso_week?: number | null
          iso_year?: number | null
          kind?: Database["public"]["Enums"]["inventory_kind"]
          name_snapshot?: string
          period_key?: string
          source?: Database["public"]["Enums"]["schedule_source"]
          status?: Database["public"]["Enums"]["inventory_status"]
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_instances_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_instances_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "inventory_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_locations: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      inventory_notifications: {
        Row: {
          id: string
          instance_id: string
          kind: string
          recipients: number
          sent_at: string
        }
        Insert: {
          id?: string
          instance_id: string
          kind: string
          recipients?: number
          sent_at?: string
        }
        Update: {
          id?: string
          instance_id?: string
          kind?: string
          recipients?: number
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_notifications_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "inventory_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_resolutions: {
        Row: {
          difference_at: number | null
          digital_at: number | null
          id: string
          instance_id: string
          instance_item_id: string
          note: string
          physical_stock_at: number
          resolved_at: string
          resolved_by: string | null
          superseded_at: string | null
        }
        Insert: {
          difference_at?: number | null
          digital_at?: number | null
          id?: string
          instance_id: string
          instance_item_id: string
          note: string
          physical_stock_at: number
          resolved_at?: string
          resolved_by?: string | null
          superseded_at?: string | null
        }
        Update: {
          difference_at?: number | null
          digital_at?: number | null
          id?: string
          instance_id?: string
          instance_item_id?: string
          note?: string
          physical_stock_at?: number
          resolved_at?: string
          resolved_by?: string | null
          superseded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_resolutions_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "inventory_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_resolutions_instance_item_id_fkey"
            columns: ["instance_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_instance_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_resolutions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_template_assignees: {
        Row: {
          template_id: string
          user_id: string
        }
        Insert: {
          template_id: string
          user_id: string
        }
        Update: {
          template_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_template_assignees_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "inventory_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_template_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_template_items: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          item_group: string | null
          name: string
          product_id: string | null
          sort_order: number
          template_id: string
          translations: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          item_group?: string | null
          name: string
          product_id?: string | null
          sort_order?: number
          template_id: string
          translations?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          item_group?: string | null
          name?: string
          product_id?: string | null
          sort_order?: number
          template_id?: string
          translations?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_template_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_template_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "inventory_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_templates: {
        Row: {
          brand_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          digital_enabled: boolean
          frequency: Database["public"]["Enums"]["inventory_frequency"]
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["inventory_kind"]
          name: string
          schedule_config: Json | null
          short_shelf_life_months: number | null
          slug: string
          translations: Json
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          digital_enabled?: boolean
          frequency: Database["public"]["Enums"]["inventory_frequency"]
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["inventory_kind"]
          name: string
          schedule_config?: Json | null
          short_shelf_life_months?: number | null
          slug: string
          translations?: Json
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          digital_enabled?: boolean
          frequency?: Database["public"]["Enums"]["inventory_frequency"]
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["inventory_kind"]
          name?: string
          schedule_config?: Json | null
          short_shelf_life_months?: number | null
          slug?: string
          translations?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_templates_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lot_allocations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          lot_number: string
          note: string | null
          order_line_id: string
          quantity: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          lot_number: string
          note?: string | null
          order_line_id: string
          quantity: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          lot_number?: string
          note?: string | null
          order_line_id?: string
          quantity?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lot_allocations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_allocations_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["order_line_id"]
          },
          {
            foreignKeyName: "lot_allocations_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_allocations_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_post_files: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string
          post_id: string
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime_type: string
          post_id: string
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string
          post_id?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_post_files_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "marketing_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_post_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_post_products: {
        Row: {
          post_id: string
          product_id: string
        }
        Insert: {
          post_id: string
          product_id: string
        }
        Update: {
          post_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_post_products_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "marketing_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_post_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "marketing_post_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_posts: {
        Row: {
          brand_id: string | null
          caption: string | null
          channels: string[]
          comments: number | null
          created_at: string
          created_by: string | null
          event_id: string | null
          id: string
          likes: number | null
          planned_on: string | null
          published_on: string | null
          reach: number | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          caption?: string | null
          channels?: string[]
          comments?: number | null
          created_at?: string
          created_by?: string | null
          event_id?: string | null
          id?: string
          likes?: number | null
          planned_on?: string | null
          published_on?: string | null
          reach?: number | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          caption?: string | null
          channels?: string[]
          comments?: number | null
          created_at?: string
          created_by?: string | null
          event_id?: string | null
          id?: string
          likes?: number | null
          planned_on?: string | null
          published_on?: string | null
          reach?: number | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_posts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_posts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_posts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_request_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          request_id: string
        }
        Insert: {
          author_id?: string
          body: string
          created_at?: string
          id?: string
          request_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_request_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_request_comments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "marketing_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_request_files: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string
          request_id: string
          size_bytes: number
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime_type: string
          request_id: string
          size_bytes: number
          storage_path: string
          uploaded_by?: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string
          request_id?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_request_files_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "marketing_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_request_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_requests: {
        Row: {
          brand_id: string | null
          created_at: string
          description: string | null
          done_at: string | null
          due_on: string | null
          id: string
          post_id: string | null
          requested_by: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          created_at?: string
          description?: string | null
          done_at?: string | null
          due_on?: string | null
          id?: string
          post_id?: string | null
          requested_by?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          created_at?: string
          description?: string | null
          done_at?: string | null
          due_on?: string | null
          id?: string
          post_id?: string | null
          requested_by?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_requests_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_requests_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "marketing_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_invitees: {
        Row: {
          meeting_id: string
          note: string | null
          profile_id: string
          responded_at: string | null
          response: string
        }
        Insert: {
          meeting_id: string
          note?: string | null
          profile_id: string
          responded_at?: string | null
          response?: string
        }
        Update: {
          meeting_id?: string
          note?: string | null
          profile_id?: string
          responded_at?: string | null
          response?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_invitees_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_invitees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_notices: {
        Row: {
          kind: string
          meeting_id: string
          profile_id: string
          sent_at: string
        }
        Insert: {
          kind: string
          meeting_id: string
          profile_id: string
          sent_at?: string
        }
        Update: {
          kind?: string
          meeting_id?: string
          profile_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_notices_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_notices_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_series: {
        Row: {
          agenda: string | null
          created_at: string
          created_by: string | null
          end_time: string
          ended_at: string | null
          id: string
          interval_weeks: number
          monthly_nth: number | null
          organizer_id: string
          place: string | null
          place_detail: string | null
          start_time: string
          starts_on: string
          title: string
          until: string | null
          updated_at: string
          weekday: number
        }
        Insert: {
          agenda?: string | null
          created_at?: string
          created_by?: string | null
          end_time: string
          ended_at?: string | null
          id?: string
          interval_weeks?: number
          monthly_nth?: number | null
          organizer_id: string
          place?: string | null
          place_detail?: string | null
          start_time: string
          starts_on: string
          title: string
          until?: string | null
          updated_at?: string
          weekday: number
        }
        Update: {
          agenda?: string | null
          created_at?: string
          created_by?: string | null
          end_time?: string
          ended_at?: string | null
          id?: string
          interval_weeks?: number
          monthly_nth?: number | null
          organizer_id?: string
          place?: string | null
          place_detail?: string | null
          start_time?: string
          starts_on?: string
          title?: string
          until?: string | null
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "meeting_series_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_series_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_series_invitees: {
        Row: {
          profile_id: string
          series_id: string
        }
        Insert: {
          profile_id: string
          series_id: string
        }
        Update: {
          profile_id?: string
          series_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_series_invitees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_series_invitees_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "meeting_series"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_summaries: {
        Row: {
          attached_at: string
          attached_by: string | null
          meeting_id: string
          summary_id: string
        }
        Insert: {
          attached_at?: string
          attached_by?: string | null
          meeting_id: string
          summary_id: string
        }
        Update: {
          attached_at?: string
          attached_by?: string | null
          meeting_id?: string
          summary_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_summaries_attached_by_fkey"
            columns: ["attached_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_summaries_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_summaries_summary_id_fkey"
            columns: ["summary_id"]
            isOneToOne: false
            referencedRelation: "sales_summaries"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          agenda: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          detached: boolean
          end_time: string
          id: string
          meeting_date: string
          minutes: string | null
          minutes_at: string | null
          minutes_by: string | null
          organizer_id: string
          place: string | null
          place_detail: string | null
          series_id: string | null
          start_time: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          agenda?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          detached?: boolean
          end_time: string
          id?: string
          meeting_date: string
          minutes?: string | null
          minutes_at?: string | null
          minutes_by?: string | null
          organizer_id: string
          place?: string | null
          place_detail?: string | null
          series_id?: string | null
          start_time: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          agenda?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          detached?: boolean
          end_time?: string
          id?: string
          meeting_date?: string
          minutes?: string | null
          minutes_at?: string | null
          minutes_by?: string | null
          organizer_id?: string
          place?: string | null
          place_detail?: string | null
          series_id?: string | null
          start_time?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_minutes_by_fkey"
            columns: ["minutes_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "meeting_series"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_inbox: {
        Row: {
          body: string
          created_at: string
          dedupe_key: string | null
          id: string
          level: string | null
          read_at: string | null
          tag: string
          title: string
          url: string | null
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          dedupe_key?: string | null
          id?: string
          level?: string | null
          read_at?: string | null
          tag: string
          title: string
          url?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          dedupe_key?: string | null
          id?: string
          level?: string | null
          read_at?: string | null
          tag?: string
          title?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_inbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json | null
          id: string
          order_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          order_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_audit_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_audit_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_boxes: {
        Row: {
          box_type_id: string
          created_at: string
          created_by: string | null
          id: string
          order_id: string
          quantity: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          box_type_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          order_id: string
          quantity: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          box_type_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          order_id?: string
          quantity?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_boxes_box_type_id_fkey"
            columns: ["box_type_id"]
            isOneToOne: false
            referencedRelation: "box_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_boxes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_boxes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_boxes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_boxes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_lines: {
        Row: {
          created_at: string
          generated_quantity: number | null
          id: string
          note: string | null
          order_id: string
          ordered_quantity: number
          position: number
          product_id: string
          shortfall_code: string | null
          shortfall_incident_id: string | null
          shortfall_reason: string | null
          source_text: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          generated_quantity?: number | null
          id?: string
          note?: string | null
          order_id: string
          ordered_quantity: number
          position?: number
          product_id: string
          shortfall_code?: string | null
          shortfall_incident_id?: string | null
          shortfall_reason?: string | null
          source_text?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          generated_quantity?: number | null
          id?: string
          note?: string | null
          order_id?: string
          ordered_quantity?: number
          position?: number
          product_id?: string
          shortfall_code?: string | null
          shortfall_incident_id?: string | null
          shortfall_reason?: string | null
          source_text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_shortfall_incident_id_fkey"
            columns: ["shortfall_incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      order_notifications: {
        Row: {
          id: string
          level: string
          order_id: string
          recipients: number
          sent_at: string
        }
        Insert: {
          id?: string
          level: string
          order_id: string
          recipients?: number
          sent_at?: string
        }
        Update: {
          id?: string
          level?: string
          order_id?: string
          recipients?: number
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_notifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_notifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_request_templates: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          default_unit: string
          first_data_row: number
          header_row: number | null
          header_signature: string[]
          id: string
          is_active: boolean
          name: string
          notes_column: string | null
          product_column: string
          quantity_column: string
          sheet_name: string | null
          unit_column: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          default_unit?: string
          first_data_row?: number
          header_row?: number | null
          header_signature?: string[]
          id?: string
          is_active?: boolean
          name: string
          notes_column?: string | null
          product_column: string
          quantity_column: string
          sheet_name?: string | null
          unit_column?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          default_unit?: string
          first_data_row?: number
          header_row?: number | null
          header_signature?: string[]
          id?: string
          is_active?: boolean
          name?: string
          notes_column?: string | null
          product_column?: string
          quantity_column?: string
          sheet_name?: string | null
          unit_column?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_request_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_request_templates_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_request_templates_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          delivery_date: string
          delivery_method_id: string
          delivery_time: string | null
          generated_from_template_id: string | null
          id: string
          import_key: string | null
          import_source: string | null
          note: string | null
          order_date: string
          order_type: Database["public"]["Enums"]["order_type"]
          preparation_date: string
          ready_at: string | null
          ready_by: string | null
          recurring_template_id: string | null
          reference: number
          replaces_incident_id: string | null
          route_position: number | null
          shipped_at: string | null
          shipped_by: string | null
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          delivery_date: string
          delivery_method_id: string
          delivery_time?: string | null
          generated_from_template_id?: string | null
          id?: string
          import_key?: string | null
          import_source?: string | null
          note?: string | null
          order_date?: string
          order_type?: Database["public"]["Enums"]["order_type"]
          preparation_date: string
          ready_at?: string | null
          ready_by?: string | null
          recurring_template_id?: string | null
          reference?: never
          replaces_incident_id?: string | null
          route_position?: number | null
          shipped_at?: string | null
          shipped_by?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          delivery_date?: string
          delivery_method_id?: string
          delivery_time?: string | null
          generated_from_template_id?: string | null
          id?: string
          import_key?: string | null
          import_source?: string | null
          note?: string | null
          order_date?: string
          order_type?: Database["public"]["Enums"]["order_type"]
          preparation_date?: string
          ready_at?: string | null
          ready_by?: string | null
          recurring_template_id?: string | null
          reference?: never
          replaces_incident_id?: string | null
          route_position?: number | null
          shipped_at?: string | null
          shipped_by?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "orders_delivery_method_id_fkey"
            columns: ["delivery_method_id"]
            isOneToOne: false
            referencedRelation: "delivery_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_generated_from_template_id_fkey"
            columns: ["generated_from_template_id"]
            isOneToOne: false
            referencedRelation: "recurring_order_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_ready_by_fkey"
            columns: ["ready_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_recurring_template_id_fkey"
            columns: ["recurring_template_id"]
            isOneToOne: false
            referencedRelation: "recurring_order_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_replaces_incident_id_fkey"
            columns: ["replaces_incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_shipped_by_fkey"
            columns: ["shipped_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_catalog: {
        Row: {
          is_configurable: boolean
          key: string
          module: string
          sort_order: number
        }
        Insert: {
          is_configurable?: boolean
          key: string
          module: string
          sort_order?: number
        }
        Update: {
          is_configurable?: boolean
          key?: string
          module?: string
          sort_order?: number
        }
        Relationships: []
      }
      personal_task_categories: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          owner_id: string
          sort_order: number
          topic_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name: string
          owner_id?: string
          sort_order?: number
          topic_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          sort_order?: number
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_task_categories_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_task_categories_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "personal_task_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      personal_task_topics: {
        Row: {
          archived_at: string | null
          color: string | null
          created_at: string
          id: string
          name: string
          owner_id: string
          sort_order: number
        }
        Insert: {
          archived_at?: string | null
          color?: string | null
          created_at?: string
          id?: string
          name: string
          owner_id?: string
          sort_order?: number
        }
        Update: {
          archived_at?: string | null
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "personal_task_topics_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      personal_tasks: {
        Row: {
          cancelled_at: string | null
          category_id: string | null
          completed_at: string | null
          created_at: string
          customer_id: string | null
          due_date: string | null
          due_time: string | null
          event_id: string | null
          goods_reception_id: string | null
          hr_note_id: string | null
          id: string
          incident_id: string | null
          inventory_instance_id: string | null
          marketing_post_id: string | null
          marketing_request_id: string | null
          notes: string | null
          order_id: string | null
          owner_id: string
          product_id: string | null
          source_reminder_id: string | null
          status: string
          task_id: string | null
          title: string
          topic_id: string | null
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          category_id?: string | null
          completed_at?: string | null
          created_at?: string
          customer_id?: string | null
          due_date?: string | null
          due_time?: string | null
          event_id?: string | null
          goods_reception_id?: string | null
          hr_note_id?: string | null
          id?: string
          incident_id?: string | null
          inventory_instance_id?: string | null
          marketing_post_id?: string | null
          marketing_request_id?: string | null
          notes?: string | null
          order_id?: string | null
          owner_id: string
          product_id?: string | null
          source_reminder_id?: string | null
          status?: string
          task_id?: string | null
          title: string
          topic_id?: string | null
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          category_id?: string | null
          completed_at?: string | null
          created_at?: string
          customer_id?: string | null
          due_date?: string | null
          due_time?: string | null
          event_id?: string | null
          goods_reception_id?: string | null
          hr_note_id?: string | null
          id?: string
          incident_id?: string | null
          inventory_instance_id?: string | null
          marketing_post_id?: string | null
          marketing_request_id?: string | null
          notes?: string | null
          order_id?: string | null
          owner_id?: string
          product_id?: string | null
          source_reminder_id?: string | null
          status?: string
          task_id?: string | null
          title?: string
          topic_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_tasks_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "personal_task_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "personal_tasks_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_goods_reception_id_fkey"
            columns: ["goods_reception_id"]
            isOneToOne: false
            referencedRelation: "goods_receptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_hr_note_id_fkey"
            columns: ["hr_note_id"]
            isOneToOne: false
            referencedRelation: "hr_note_follow_up_state"
            referencedColumns: ["note_id"]
          },
          {
            foreignKeyName: "personal_tasks_hr_note_id_fkey"
            columns: ["hr_note_id"]
            isOneToOne: false
            referencedRelation: "hr_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_inventory_instance_id_fkey"
            columns: ["inventory_instance_id"]
            isOneToOne: false
            referencedRelation: "inventory_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_marketing_post_id_fkey"
            columns: ["marketing_post_id"]
            isOneToOne: false
            referencedRelation: "marketing_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_marketing_request_id_fkey"
            columns: ["marketing_request_id"]
            isOneToOne: false
            referencedRelation: "marketing_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "personal_tasks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "personal_tasks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_source_reminder_fkey"
            columns: ["source_reminder_id"]
            isOneToOne: false
            referencedRelation: "reminders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "personal_task_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      product_aliases: {
        Row: {
          alias: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          product_id: string
          updated_at: string
        }
        Insert: {
          alias: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          product_id: string
          updated_at?: string
        }
        Update: {
          alias?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_aliases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_aliases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_aliases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "product_aliases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_aliases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          name_de: string | null
          name_es: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          name_de?: string | null
          name_es?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          name_de?: string | null
          name_es?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      product_subcategories: {
        Row: {
          category_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          name_de: string | null
          name_es: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          name_de?: string | null
          name_es?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          name_de?: string | null
          name_es?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_subcategories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      production_records: {
        Row: {
          best_before: string | null
          lot_number: string | null
          occurrence_id: string
          produced_quantity: number
          product_id: string
          recorded_at: string
          recorded_by: string | null
          shortfall_note: string | null
          shortfall_reason: string | null
          target_quantity: number
        }
        Insert: {
          best_before?: string | null
          lot_number?: string | null
          occurrence_id: string
          produced_quantity: number
          product_id: string
          recorded_at?: string
          recorded_by?: string | null
          shortfall_note?: string | null
          shortfall_reason?: string | null
          target_quantity: number
        }
        Update: {
          best_before?: string | null
          lot_number?: string | null
          occurrence_id?: string
          produced_quantity?: number
          product_id?: string
          recorded_at?: string
          recorded_by?: string | null
          shortfall_note?: string | null
          shortfall_reason?: string | null
          target_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "production_records_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: true
            referencedRelation: "task_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_records_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "production_records_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_records_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand_id: string | null
          category: string | null
          category_id: string | null
          code: string | null
          created_at: string
          family: string
          gross_weight_kg: number | null
          gross_weight_suggested: boolean
          id: string
          is_active: boolean
          name: string | null
          needs_review: boolean
          net_weight_kg: number | null
          net_weight_suggested: boolean
          notes: string | null
          presentation: string
          subcategory_id: string | null
          units_per_box: number | null
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          category?: string | null
          category_id?: string | null
          code?: string | null
          created_at?: string
          family: string
          gross_weight_kg?: number | null
          gross_weight_suggested?: boolean
          id?: string
          is_active?: boolean
          name?: string | null
          needs_review?: boolean
          net_weight_kg?: number | null
          net_weight_suggested?: boolean
          notes?: string | null
          presentation: string
          subcategory_id?: string | null
          units_per_box?: number | null
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          category?: string | null
          category_id?: string | null
          code?: string | null
          created_at?: string
          family?: string
          gross_weight_kg?: number | null
          gross_weight_suggested?: boolean
          id?: string
          is_active?: boolean
          name?: string | null
          needs_review?: boolean
          net_weight_kg?: number | null
          net_weight_suggested?: boolean
          notes?: string | null
          presentation?: string
          subcategory_id?: string | null
          units_per_box?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_subcategory_fkey"
            columns: ["subcategory_id", "category_id"]
            isOneToOne: false
            referencedRelation: "product_subcategories"
            referencedColumns: ["id", "category_id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          deleted_at: string | null
          email: string
          id: string
          job_title: string | null
          last_seen_at: string | null
          must_change_password: boolean
          name: string | null
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["user_status"]
          team: Database["public"]["Enums"]["team"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          email: string
          id: string
          job_title?: string | null
          last_seen_at?: string | null
          must_change_password?: boolean
          name?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
          team?: Database["public"]["Enums"]["team"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          email?: string
          id?: string
          job_title?: string | null
          last_seen_at?: string | null
          must_change_password?: boolean
          name?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
          team?: Database["public"]["Enums"]["team"]
          updated_at?: string
        }
        Relationships: []
      }
      prospect_lost_reasons: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          translations: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          translations?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          translations?: Json
          updated_at?: string
        }
        Relationships: []
      }
      prospect_notes: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          kind_id: string
          note_date: string
          prospect_id: string
          starred: boolean
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind_id: string
          note_date: string
          prospect_id: string
          starred?: boolean
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind_id?: string
          note_date?: string
          prospect_id?: string
          starred?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "prospect_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_notes_kind_id_fkey"
            columns: ["kind_id"]
            isOneToOne: false
            referencedRelation: "sales_activity_kinds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_notes_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_sources: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          translations: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          translations?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          translations?: Json
          updated_at?: string
        }
        Relationships: []
      }
      prospects: {
        Row: {
          city: string | null
          closed_at: string | null
          company_name: string
          contact_name: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_type_id: string | null
          email: string | null
          event_id: string | null
          id: string
          interest: string | null
          latitude: number | null
          longitude: number | null
          lost_note: string | null
          lost_reason_id: string | null
          owner_id: string | null
          phone: string | null
          postal_code: string | null
          source_id: string | null
          stage: string
          street: string | null
          updated_at: string
          weekly_volume: string | null
        }
        Insert: {
          city?: string | null
          closed_at?: string | null
          company_name: string
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_type_id?: string | null
          email?: string | null
          event_id?: string | null
          id?: string
          interest?: string | null
          latitude?: number | null
          longitude?: number | null
          lost_note?: string | null
          lost_reason_id?: string | null
          owner_id?: string | null
          phone?: string | null
          postal_code?: string | null
          source_id?: string | null
          stage?: string
          street?: string | null
          updated_at?: string
          weekly_volume?: string | null
        }
        Update: {
          city?: string | null
          closed_at?: string | null
          company_name?: string
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_type_id?: string | null
          email?: string | null
          event_id?: string | null
          id?: string
          interest?: string | null
          latitude?: number | null
          longitude?: number | null
          lost_note?: string | null
          lost_reason_id?: string | null
          owner_id?: string | null
          phone?: string | null
          postal_code?: string | null
          source_id?: string | null
          stage?: string
          street?: string | null
          updated_at?: string
          weekly_volume?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "prospects_customer_type_id_fkey"
            columns: ["customer_type_id"]
            isOneToOne: false
            referencedRelation: "customer_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_lost_reason_id_fkey"
            columns: ["lost_reason_id"]
            isOneToOne: false
            referencedRelation: "prospect_lost_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "prospect_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failure_count: number
          id: string
          last_used_at: string | null
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failure_count?: number
          id?: string
          last_used_at?: string | null
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failure_count?: number
          id?: string
          last_used_at?: string | null
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_note_items: {
        Row: {
          body: string
          done: boolean
          done_at: string | null
          done_by: string | null
          id: string
          note_id: string
          sort_order: number
        }
        Insert: {
          body: string
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          id?: string
          note_id: string
          sort_order?: number
        }
        Update: {
          body?: string
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          id?: string
          note_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "quick_note_items_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_note_items_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "quick_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_note_shares: {
        Row: {
          note_id: string
          profile_id: string
        }
        Insert: {
          note_id: string
          profile_id: string
        }
        Update: {
          note_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_note_shares_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "quick_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_note_shares_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_notes: {
        Row: {
          archived_at: string | null
          body: string
          created_at: string
          customer_id: string | null
          id: string
          owner_id: string
          pinned: boolean
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          body?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          owner_id?: string
          pinned?: boolean
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          body?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          owner_id?: string
          pinned?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "quick_notes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_order_template_lines: {
        Row: {
          default_quantity: number
          id: string
          position: number
          product_id: string
          template_id: string
        }
        Insert: {
          default_quantity: number
          id?: string
          position?: number
          product_id: string
          template_id: string
        }
        Update: {
          default_quantity?: number
          id?: string
          position?: number
          product_id?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_order_template_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "recurring_order_template_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_order_template_lines_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "recurring_order_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_order_templates: {
        Row: {
          anchor_date: string | null
          created_at: string
          customer_id: string
          delivery_method_id: string
          delivery_weekday: number
          id: string
          interval_weeks: number
          is_active: boolean
          name: string | null
          note: string | null
          order_type: Database["public"]["Enums"]["order_type"]
          preparation_lead_days: number
          updated_at: string
        }
        Insert: {
          anchor_date?: string | null
          created_at?: string
          customer_id: string
          delivery_method_id: string
          delivery_weekday: number
          id?: string
          interval_weeks?: number
          is_active?: boolean
          name?: string | null
          note?: string | null
          order_type?: Database["public"]["Enums"]["order_type"]
          preparation_lead_days?: number
          updated_at?: string
        }
        Update: {
          anchor_date?: string | null
          created_at?: string
          customer_id?: string
          delivery_method_id?: string
          delivery_weekday?: number
          id?: string
          interval_weeks?: number
          is_active?: boolean
          name?: string | null
          note?: string | null
          order_type?: Database["public"]["Enums"]["order_type"]
          preparation_lead_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_order_templates_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_order_templates_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "recurring_order_templates_delivery_method_id_fkey"
            columns: ["delivery_method_id"]
            isOneToOne: false
            referencedRelation: "delivery_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json
          id: string
          reminder_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          reminder_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          reminder_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_events_reminder_id_fkey"
            columns: ["reminder_id"]
            isOneToOne: false
            referencedRelation: "reminders"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_notifications: {
        Row: {
          id: string
          kind: string
          recipients: number
          reminder_id: string
          sent_at: string
          slot_at: string
          step: number
        }
        Insert: {
          id?: string
          kind: string
          recipients?: number
          reminder_id: string
          sent_at?: string
          slot_at: string
          step?: number
        }
        Update: {
          id?: string
          kind?: string
          recipients?: number
          reminder_id?: string
          sent_at?: string
          slot_at?: string
          step?: number
        }
        Relationships: [
          {
            foreignKeyName: "reminder_notifications_reminder_id_fkey"
            columns: ["reminder_id"]
            isOneToOne: false
            referencedRelation: "reminders"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_participants: {
        Row: {
          added_by: string | null
          created_at: string
          reminder_id: string
          user_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          reminder_id: string
          user_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          reminder_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_participants_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_participants_reminder_id_fkey"
            columns: ["reminder_id"]
            isOneToOne: false
            referencedRelation: "reminders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          converted_at: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          due_at: string
          event_id: string | null
          goods_reception_id: string | null
          hr_note_id: string | null
          id: string
          incident_id: string | null
          inventory_instance_id: string | null
          is_shared: boolean
          marketing_post_id: string | null
          marketing_request_id: string | null
          next_at: string | null
          notes: string | null
          notify_before_minutes: number | null
          order_id: string | null
          personal_task_id: string | null
          product_id: string | null
          recurrence: string
          recurrence_anchor: string | null
          snoozed_until: string | null
          status: string
          task_id: string | null
          timezone: string
          title: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          converted_at?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          due_at: string
          event_id?: string | null
          goods_reception_id?: string | null
          hr_note_id?: string | null
          id?: string
          incident_id?: string | null
          inventory_instance_id?: string | null
          is_shared?: boolean
          marketing_post_id?: string | null
          marketing_request_id?: string | null
          next_at?: string | null
          notes?: string | null
          notify_before_minutes?: number | null
          order_id?: string | null
          personal_task_id?: string | null
          product_id?: string | null
          recurrence?: string
          recurrence_anchor?: string | null
          snoozed_until?: string | null
          status?: string
          task_id?: string | null
          timezone?: string
          title: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          converted_at?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          due_at?: string
          event_id?: string | null
          goods_reception_id?: string | null
          hr_note_id?: string | null
          id?: string
          incident_id?: string | null
          inventory_instance_id?: string | null
          is_shared?: boolean
          marketing_post_id?: string | null
          marketing_request_id?: string | null
          next_at?: string | null
          notes?: string | null
          notify_before_minutes?: number | null
          order_id?: string | null
          personal_task_id?: string | null
          product_id?: string | null
          recurrence?: string
          recurrence_anchor?: string | null
          snoozed_until?: string | null
          status?: string
          task_id?: string | null
          timezone?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "reminders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_goods_reception_id_fkey"
            columns: ["goods_reception_id"]
            isOneToOne: false
            referencedRelation: "goods_receptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_hr_note_id_fkey"
            columns: ["hr_note_id"]
            isOneToOne: false
            referencedRelation: "hr_note_follow_up_state"
            referencedColumns: ["note_id"]
          },
          {
            foreignKeyName: "reminders_hr_note_id_fkey"
            columns: ["hr_note_id"]
            isOneToOne: false
            referencedRelation: "hr_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_inventory_instance_id_fkey"
            columns: ["inventory_instance_id"]
            isOneToOne: false
            referencedRelation: "inventory_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_marketing_post_id_fkey"
            columns: ["marketing_post_id"]
            isOneToOne: false
            referencedRelation: "marketing_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_marketing_request_id_fkey"
            columns: ["marketing_request_id"]
            isOneToOne: false
            referencedRelation: "marketing_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "reminders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_personal_task_id_fkey"
            columns: ["personal_task_id"]
            isOneToOne: false
            referencedRelation: "personal_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reminders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_requests: {
        Row: {
          cost: number | null
          created_at: string
          description: string | null
          equipment_id: string | null
          fixed_at: string | null
          fixed_by: string | null
          id: string
          place: string | null
          reported_by: string
          resolution: string | null
          status: string
          task_id: string | null
          title: string
          updated_at: string
          urgency: string
        }
        Insert: {
          cost?: number | null
          created_at?: string
          description?: string | null
          equipment_id?: string | null
          fixed_at?: string | null
          fixed_by?: string | null
          id?: string
          place?: string | null
          reported_by?: string
          resolution?: string | null
          status?: string
          task_id?: string | null
          title: string
          updated_at?: string
          urgency?: string
        }
        Update: {
          cost?: number | null
          created_at?: string
          description?: string | null
          equipment_id?: string | null
          fixed_at?: string | null
          fixed_by?: string | null
          id?: string
          place?: string | null
          reported_by?: string
          resolution?: string | null
          status?: string
          task_id?: string | null
          title?: string
          updated_at?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_requests_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_requests_fixed_by_fkey"
            columns: ["fixed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_requests_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          granted_by: string | null
          permission: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          granted_by?: string | null
          permission: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          granted_by?: string | null
          permission?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_permission_fkey"
            columns: ["permission"]
            isOneToOne: false
            referencedRelation: "permission_catalog"
            referencedColumns: ["key"]
          },
        ]
      }
      sales_activities: {
        Row: {
          activity_date: string
          activity_end: string | null
          activity_time: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          done_at: string | null
          event_id: string | null
          follows_id: string | null
          id: string
          kind_id: string
          place: string | null
          place_detail: string | null
          position: number
          prospect_id: string | null
          reminded_at: string | null
          salesperson_id: string
          status: string
          title: string | null
        }
        Insert: {
          activity_date: string
          activity_end?: string | null
          activity_time?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          done_at?: string | null
          event_id?: string | null
          follows_id?: string | null
          id?: string
          kind_id: string
          place?: string | null
          place_detail?: string | null
          position?: number
          prospect_id?: string | null
          reminded_at?: string | null
          salesperson_id: string
          status?: string
          title?: string | null
        }
        Update: {
          activity_date?: string
          activity_end?: string | null
          activity_time?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          done_at?: string | null
          event_id?: string | null
          follows_id?: string | null
          id?: string
          kind_id?: string
          place?: string | null
          place_detail?: string | null
          position?: number
          prospect_id?: string | null
          reminded_at?: string | null
          salesperson_id?: string
          status?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_activities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_activities_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_activities_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sales_activities_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_activities_follows_id_fkey"
            columns: ["follows_id"]
            isOneToOne: false
            referencedRelation: "sales_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_activities_kind_id_fkey"
            columns: ["kind_id"]
            isOneToOne: false
            referencedRelation: "sales_activity_kinds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_activities_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_activities_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_activity_kinds: {
        Row: {
          behavior: string
          created_at: string
          default_minutes: number
          icon: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          translations: Json
          updated_at: string
        }
        Insert: {
          behavior?: string
          created_at?: string
          default_minutes?: number
          icon?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          translations?: Json
          updated_at?: string
        }
        Update: {
          behavior?: string
          created_at?: string
          default_minutes?: number
          icon?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          translations?: Json
          updated_at?: string
        }
        Relationships: []
      }
      sales_activity_participants: {
        Row: {
          activity_id: string
          added_by: string | null
          created_at: string
          profile_id: string
        }
        Insert: {
          activity_id: string
          added_by?: string | null
          created_at?: string
          profile_id: string
        }
        Update: {
          activity_id?: string
          added_by?: string | null
          created_at?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_activity_participants_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "sales_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_activity_participants_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_activity_participants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_plan_notices: {
        Row: {
          day: string
          sent_at: string
          user_id: string
        }
        Insert: {
          day: string
          sent_at?: string
          user_id: string
        }
        Update: {
          day?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_plan_notices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_quiet_notices: {
        Row: {
          sent_at: string
          user_id: string
          week_start: string
        }
        Insert: {
          sent_at?: string
          user_id: string
          week_start: string
        }
        Update: {
          sent_at?: string
          user_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_quiet_notices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_start_points: {
        Row: {
          city: string | null
          latitude: number | null
          longitude: number | null
          postal_code: string | null
          street: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          city?: string | null
          latitude?: number | null
          longitude?: number | null
          postal_code?: string | null
          street?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          city?: string | null
          latitude?: number | null
          longitude?: number | null
          postal_code?: string | null
          street?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_start_points_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_summaries: {
        Row: {
          content: Json
          created_at: string
          created_by: string | null
          id: string
          period_from: string
          period_to: string
          title: string
        }
        Insert: {
          content: Json
          created_at?: string
          created_by?: string | null
          id?: string
          period_from: string
          period_to: string
          title: string
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          period_from?: string
          period_to?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_summaries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_summary_recipients: {
        Row: {
          profile_id: string
          sent_at: string
          sent_by: string | null
          summary_id: string
        }
        Insert: {
          profile_id: string
          sent_at?: string
          sent_by?: string | null
          summary_id: string
        }
        Update: {
          profile_id?: string
          sent_at?: string
          sent_by?: string | null
          summary_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_summary_recipients_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_summary_recipients_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_summary_recipients_summary_id_fkey"
            columns: ["summary_id"]
            isOneToOne: false
            referencedRelation: "sales_summaries"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_visit_days: {
        Row: {
          end_at: string
          salesperson_id: string
          start_at: string
          visit_date: string
        }
        Insert: {
          end_at?: string
          salesperson_id: string
          start_at?: string
          visit_date: string
        }
        Update: {
          end_at?: string
          salesperson_id?: string
          start_at?: string
          visit_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_visit_days_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      security_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          new_value: Json | null
          previous_value: Json | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_value?: Json | null
          previous_value?: Json | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_value?: Json | null
          previous_value?: Json | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_audit_log_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          created_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          new_value: Json | null
          occurrence_id: string | null
          previous_value: Json | null
          task_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_value?: Json | null
          occurrence_id?: string | null
          previous_value?: Json | null
          task_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_value?: Json | null
          occurrence_id?: string | null
          previous_value?: Json | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_audit_log_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "task_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_audit_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          occurrence_id: string
          task_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          occurrence_id: string
          task_id: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          occurrence_id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "task_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_day_removals: {
        Row: {
          due_date: string
          removed_at: string
          removed_by: string | null
          task_id: string
        }
        Insert: {
          due_date: string
          removed_at?: string
          removed_by?: string | null
          task_id: string
        }
        Update: {
          due_date?: string
          removed_at?: string
          removed_by?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_day_removals_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_day_removals_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_occurrences: {
        Row: {
          assignee_id: string | null
          assignee_manual: boolean
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          completed_at: string | null
          completed_by: string | null
          covered_assignment_id: string | null
          created_at: string
          due_date: string
          due_date_override: string | null
          effective_due_date: string | null
          id: string
          period_key: string
          skip_reason: string | null
          skipped_at: string | null
          skipped_by: string | null
          source: Database["public"]["Enums"]["schedule_source"]
          status: Database["public"]["Enums"]["occurrence_status"]
          target_quantity: number | null
          task_id: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          assignee_manual?: boolean
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          completed_at?: string | null
          completed_by?: string | null
          covered_assignment_id?: string | null
          created_at?: string
          due_date: string
          due_date_override?: string | null
          effective_due_date?: string | null
          id?: string
          period_key: string
          skip_reason?: string | null
          skipped_at?: string | null
          skipped_by?: string | null
          source?: Database["public"]["Enums"]["schedule_source"]
          status?: Database["public"]["Enums"]["occurrence_status"]
          target_quantity?: number | null
          task_id: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          assignee_manual?: boolean
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          completed_at?: string | null
          completed_by?: string | null
          covered_assignment_id?: string | null
          created_at?: string
          due_date?: string
          due_date_override?: string | null
          effective_due_date?: string | null
          id?: string
          period_key?: string
          skip_reason?: string | null
          skipped_at?: string | null
          skipped_by?: string | null
          source?: Database["public"]["Enums"]["schedule_source"]
          status?: Database["public"]["Enums"]["occurrence_status"]
          target_quantity?: number | null
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_occurrences_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_occurrences_blocked_by_fkey"
            columns: ["blocked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_occurrences_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_occurrences_covered_assignment_id_fkey"
            columns: ["covered_assignment_id"]
            isOneToOne: false
            referencedRelation: "coverage_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_occurrences_skipped_by_fkey"
            columns: ["skipped_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_occurrences_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          category_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          equipment_id: string | null
          frequency: Database["public"]["Enums"]["task_frequency"]
          id: string
          incident_id: string | null
          is_active: boolean
          is_skippable: boolean
          product_id: string | null
          schedule_config: Json | null
          starts_on: string | null
          target_quantity: number | null
          team: Database["public"]["Enums"]["team"]
          title: string
          translations: Json
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          equipment_id?: string | null
          frequency: Database["public"]["Enums"]["task_frequency"]
          id?: string
          incident_id?: string | null
          is_active?: boolean
          is_skippable?: boolean
          product_id?: string | null
          schedule_config?: Json | null
          starts_on?: string | null
          target_quantity?: number | null
          team?: Database["public"]["Enums"]["team"]
          title: string
          translations?: Json
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          equipment_id?: string | null
          frequency?: Database["public"]["Enums"]["task_frequency"]
          id?: string
          incident_id?: string | null
          is_active?: boolean
          is_skippable?: boolean
          product_id?: string | null
          schedule_config?: Json | null
          starts_on?: string | null
          target_quantity?: number | null
          team?: Database["public"]["Enums"]["team"]
          title?: string
          translations?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "lot_allocation_search"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "tasks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      team_managers: {
        Row: {
          profile_id: string
          team: Database["public"]["Enums"]["team"]
        }
        Insert: {
          profile_id: string
          team: Database["public"]["Enums"]["team"]
        }
        Update: {
          profile_id?: string
          team?: Database["public"]["Enums"]["team"]
        }
        Relationships: [
          {
            foreignKeyName: "team_managers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transporters: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transporters_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transporters_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_presence: {
        Row: {
          last_seen_at: string
          path: string | null
          started_at: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          path?: string | null
          started_at?: string
          user_id: string
        }
        Update: {
          last_seen_at?: string
          path?: string | null
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_presence_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      hr_note_follow_up_state: {
        Row: {
          closed: boolean | null
          created_by: string | null
          due_on: string | null
          note_id: string | null
          worker_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_notes_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "hr_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      lot_allocation_search: {
        Row: {
          brand_id: string | null
          brand_name: string | null
          created_at: string | null
          created_by: string | null
          customer_active: boolean | null
          customer_addition: string | null
          customer_id: string | null
          customer_name: string | null
          delivery_date: string | null
          entered_by: string | null
          id: string | null
          lot_number: string | null
          modified_by: string | null
          note: string | null
          order_id: string | null
          order_line_id: string | null
          order_reference: number | null
          order_status: string | null
          preparation_date: string | null
          product_code: string | null
          product_id: string | null
          product_name: string | null
          quantity: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lot_allocations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_allocations_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      absence_brief: {
        Args: { p_absence_id: string }
        Returns: {
          end_date: string
          end_time: string
          first_day: string
          id: string
          last_day: string
          person_name: string
          profile_id: string
          start_date: string
          start_time: string
          status: string
        }[]
      }
      absence_calendar: {
        Args: { p_from: string; p_to: string }
        Returns: {
          end_date: string
          end_time: string
          first_day: string
          id: string
          last_day: string
          person_name: string
          profile_id: string
          start_date: string
          start_time: string
        }[]
      }
      absence_cancel: { Args: { p_absence_id: string }; Returns: undefined }
      absence_decide: {
        Args: { p_absence_id: string; p_approve: boolean; p_reason?: string }
        Returns: undefined
      }
      absence_register: {
        Args: {
          p_end_date: string
          p_end_time: string
          p_first_day: string
          p_last_day: string
          p_note: string
          p_profile_id: string
          p_start_date: string
          p_start_time: string
          p_type_id: string
        }
        Returns: string
      }
      active_coverage_permissions: { Args: never; Returns: string[] }
      activity_team_paused: {
        Args: { p_team: Database["public"]["Enums"]["team"] }
        Returns: boolean
      }
      admin_delete_user: { Args: { p_user_id: string }; Returns: undefined }
      block_occurrence: {
        Args: { p_occurrence_id: string; p_reason: string }
        Returns: {
          assignee_id: string | null
          assignee_manual: boolean
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          completed_at: string | null
          completed_by: string | null
          covered_assignment_id: string | null
          created_at: string
          due_date: string
          due_date_override: string | null
          effective_due_date: string | null
          id: string
          period_key: string
          skip_reason: string | null
          skipped_at: string | null
          skipped_by: string | null
          source: Database["public"]["Enums"]["schedule_source"]
          status: Database["public"]["Enums"]["occurrence_status"]
          target_quantity: number | null
          task_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "task_occurrences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      can_act_on_occurrence: {
        Args: { p_assignee_id: string }
        Returns: boolean
      }
      can_act_on_task_occurrence: {
        Args: { p_assignee_id: string; p_task_id: string }
        Returns: boolean
      }
      can_change_meeting: { Args: { p_meeting_id: string }; Returns: boolean }
      can_change_series: { Args: { p_series_id: string }; Returns: boolean }
      can_edit_marketing: { Args: never; Returns: boolean }
      can_manage_incident: { Args: { p_incident_id: string }; Returns: boolean }
      can_manage_maintenance: { Args: never; Returns: boolean }
      can_organize_meetings: { Args: never; Returns: boolean }
      can_plan_coverage: { Args: { p_absence_id: string }; Returns: boolean }
      can_read_marketing: { Args: never; Returns: boolean }
      can_request_marketing: { Args: never; Returns: boolean }
      can_see_handover: { Args: { p_absence_id: string }; Returns: boolean }
      can_see_marketing_request: { Args: { p_id: string }; Returns: boolean }
      can_see_meeting: { Args: { p_meeting_id: string }; Returns: boolean }
      can_see_quick_note: { Args: { p_note_id: string }; Returns: boolean }
      can_see_series: { Args: { p_series_id: string }; Returns: boolean }
      can_see_summary: { Args: { p_summary_id: string }; Returns: boolean }
      can_use_reminders: { Args: never; Returns: boolean }
      can_view_incident:
        | { Args: { p_order_id: string }; Returns: boolean }
        | {
            Args: { p_goods_reception_id: string; p_order_id: string }
            Returns: boolean
          }
        | {
            Args: {
              p_created_by: string
              p_goods_reception_id: string
              p_order_id: string
            }
            Returns: boolean
          }
      can_write_goods_reception: {
        Args: {
          p_status: Database["public"]["Enums"]["goods_reception_status"]
        }
        Returns: boolean
      }
      can_write_goods_reception_child: {
        Args: { p_reception_id: string }
        Returns: boolean
      }
      can_write_handover: { Args: { p_absence_id: string }; Returns: boolean }
      claim_push_subscription: {
        Args: {
          p_auth: string
          p_endpoint: string
          p_p256dh: string
          p_user_agent?: string
        }
        Returns: undefined
      }
      collection_customer_flags: {
        Args: never
        Returns: {
          customer_id: string
          level: string
        }[]
      }
      collection_flagged_customers: { Args: never; Returns: string[] }
      complete_occurrence: {
        Args: { p_occurrence_id: string }
        Returns: {
          assignee_id: string | null
          assignee_manual: boolean
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          completed_at: string | null
          completed_by: string | null
          covered_assignment_id: string | null
          created_at: string
          due_date: string
          due_date_override: string | null
          effective_due_date: string | null
          id: string
          period_key: string
          skip_reason: string | null
          skipped_at: string | null
          skipped_by: string | null
          source: Database["public"]["Enums"]["schedule_source"]
          status: Database["public"]["Enums"]["occurrence_status"]
          target_quantity: number | null
          task_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "task_occurrences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      covering_for: { Args: { p_profile_id: string }; Returns: boolean }
      event_cancel: {
        Args: { p_event_id: string; p_reason: string }
        Returns: string
      }
      event_confirm: { Args: { p_event_id: string }; Returns: number }
      event_customer_id: { Args: never; Returns: string }
      event_make_order: { Args: { p_event_id: string }; Returns: string }
      event_set_delivery: {
        Args: { p_date: string; p_event_id: string; p_method_id: string }
        Returns: undefined
      }
      event_set_products: {
        Args: { p_event_id: string; p_lines: Json }
        Returns: undefined
      }
      event_staff_workers: {
        Args: never
        Returns: {
          id: string
          name: string
          team: Database["public"]["Enums"]["team"]
        }[]
      }
      generate_order_from_template: {
        Args: { p_delivery_date: string; p_template_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          customer_id: string
          delivery_date: string
          delivery_method_id: string
          delivery_time: string | null
          generated_from_template_id: string | null
          id: string
          import_key: string | null
          import_source: string | null
          note: string | null
          order_date: string
          order_type: Database["public"]["Enums"]["order_type"]
          preparation_date: string
          ready_at: string | null
          ready_by: string | null
          recurring_template_id: string | null
          reference: number
          replaces_incident_id: string | null
          route_position: number | null
          shipped_at: string | null
          shipped_by: string | null
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_viewer: { Args: never; Returns: Json }
      handover_item_progress: {
        Args: { p_item_id: string; p_note: string; p_status: string }
        Returns: undefined
      }
      has_permission: { Args: { p_key: string }; Returns: boolean }
      hr_can: {
        Args: { p_team: Database["public"]["Enums"]["team"] }
        Returns: boolean
      }
      hr_can_note: { Args: { p_note_id: string }; Returns: boolean }
      hr_can_worker: { Args: { p_worker_id: string }; Returns: boolean }
      hr_celebration_recipients: {
        Args: { p_worker_id: string }
        Returns: string[]
      }
      hr_eval_admin_may: { Args: { p_request_id: string }; Returns: boolean }
      hr_eval_answer: {
        Args: {
          p_answers: Json
          p_assignment_id: string
          p_comment: string
          p_submit: boolean
        }
        Returns: undefined
      }
      hr_eval_close: { Args: { p_request_id: string }; Returns: undefined }
      hr_eval_counts: {
        Args: { p_worker_id: string }
        Returns: {
          invited: number
          request_id: string
          submitted: number
        }[]
      }
      hr_eval_invite: {
        Args: { p_evaluators: string[]; p_request_id: string }
        Returns: Json
      }
      hr_eval_is_mine: { Args: { p_request_id: string }; Returns: boolean }
      hr_eval_is_open: { Args: { p_request_id: string }; Returns: boolean }
      hr_eval_overview: { Args: { p_request_id: string }; Returns: Json }
      hr_eval_send: {
        Args: {
          p_deadline: string
          p_evaluators: string[]
          p_items: Json
          p_worker_id: string
        }
        Returns: Json
      }
      hr_eval_set_deadline: {
        Args: { p_deadline: string; p_request_id: string }
        Returns: undefined
      }
      hr_eval_uninvite: {
        Args: { p_assignment_id: string }
        Returns: undefined
      }
      hr_is_self: { Args: { p_worker_id: string }; Returns: boolean }
      hr_late_editable: { Args: { p_id: string }; Returns: boolean }
      hr_note_add: {
        Args: {
          p_follow_up_on: string
          p_follow_up_text: string
          p_no_follow_up_reason: string
          p_note_date: string
          p_participants: Json
          p_sections: Json
          p_type_id: string
          p_warning_level: string
          p_worker_id: string
        }
        Returns: string
      }
      hr_note_check_content: {
        Args: {
          p_follow_up_on: string
          p_follow_up_text: string
          p_from: string
          p_no_follow_up_reason: string
          p_sections: Json
          p_structure: string
          p_warning_level: string
        }
        Returns: undefined
      }
      hr_note_follow_up_rule: { Args: { p_structure: string }; Returns: string }
      hr_note_followup_add: {
        Args: {
          p_body: string
          p_closes: boolean
          p_entry_date: string
          p_kind: string
          p_next_on: string
          p_next_text: string
          p_no_follow_up_reason: string
          p_note_id: string
          p_participants: Json
          p_sections: Json
          p_warning_level: string
        }
        Returns: string
      }
      hr_note_put_participants: {
        Args: {
          p_followup_id: string
          p_note_id: string
          p_people: Json
          p_uid: string
        }
        Returns: undefined
      }
      hr_note_reminder_audience: {
        Args: { p_followup_id?: string; p_note_id: string }
        Returns: string[]
      }
      hr_note_required_sections: {
        Args: { p_structure: string }
        Returns: string[]
      }
      hr_scope: { Args: never; Returns: Database["public"]["Enums"]["team"] }
      hr_worker_stats: {
        Args: { p_from: string; p_to: string; p_worker_id: string }
        Returns: Json
      }
      in_incident_scope: {
        Args: { p_team: Database["public"]["Enums"]["team"] }
        Returns: boolean
      }
      in_team_scope: {
        Args: { p_team: Database["public"]["Enums"]["team"] }
        Returns: boolean
      }
      incident_scope: {
        Args: never
        Returns: Database["public"]["Enums"]["team"]
      }
      inventory_can_edit: { Args: { p_instance_id: string }; Returns: boolean }
      inventory_complete: {
        Args: { p_instance_id: string }
        Returns: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          digital_enabled: boolean
          id: string
          inventory_date: string
          iso_week: number | null
          iso_year: number | null
          kind: Database["public"]["Enums"]["inventory_kind"]
          name_snapshot: string
          period_key: string
          source: Database["public"]["Enums"]["schedule_source"]
          status: Database["public"]["Enums"]["inventory_status"]
          template_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_instances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      inventory_edit_deadline: { Args: { p_date: string }; Returns: string }
      inventory_grant_edit: {
        Args: {
          p_ends_at: string
          p_instance_id: string
          p_reason?: string
          p_scope: Database["public"]["Enums"]["inventory_grant_scope"]
          p_starts_at: string
          p_user_id: string
        }
        Returns: {
          created_at: string
          ends_at: string
          granted_by: string | null
          id: string
          instance_id: string | null
          reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          scope: Database["public"]["Enums"]["inventory_grant_scope"]
          starts_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_edit_grants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      inventory_instance_exists: {
        Args: { p_instance_id: string }
        Returns: boolean
      }
      inventory_is_mine: { Args: { p_instance_id: string }; Returns: boolean }
      inventory_item_set_done: {
        Args: { p_done: boolean; p_item_id: string }
        Returns: undefined
      }
      inventory_own_only: { Args: never; Returns: boolean }
      inventory_reopen: {
        Args: { p_instance_id: string }
        Returns: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          digital_enabled: boolean
          id: string
          inventory_date: string
          iso_week: number | null
          iso_year: number | null
          kind: Database["public"]["Enums"]["inventory_kind"]
          name_snapshot: string
          period_key: string
          source: Database["public"]["Enums"]["schedule_source"]
          status: Database["public"]["Enums"]["inventory_status"]
          template_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_instances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      inventory_resolve_item: {
        Args: { p_item_id: string; p_note: string }
        Returns: {
          counted_at: string | null
          counted_by: string | null
          created_at: string
          difference: number | null
          digital_quantity: number | null
          id: string
          instance_id: string
          is_resolved: boolean
          item_group: string | null
          item_name: string
          item_sort_order: number
          item_translations: Json
          physical_stock: number
          product_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["inventory_status"]
          template_item_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_instance_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      inventory_revoke_grant: {
        Args: { p_grant_id: string }
        Returns: {
          created_at: string
          ends_at: string
          granted_by: string | null
          id: string
          instance_id: string | null
          reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          scope: Database["public"]["Enums"]["inventory_grant_scope"]
          starts_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_edit_grants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      inventory_set_digital: {
        Args: { p_item_id: string; p_value: number }
        Returns: {
          counted_at: string | null
          counted_by: string | null
          created_at: string
          difference: number | null
          digital_quantity: number | null
          id: string
          instance_id: string
          is_resolved: boolean
          item_group: string | null
          item_name: string
          item_sort_order: number
          item_translations: Json
          physical_stock: number
          product_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["inventory_status"]
          template_item_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_instance_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      inventory_sync_brand: { Args: { p_brand_id: string }; Returns: undefined }
      inventory_sync_instance_status: {
        Args: { p_instance_id: string }
        Returns: undefined
      }
      inventory_sync_template: {
        Args: { p_template_id: string }
        Returns: undefined
      }
      is_absence_approver: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_approved: { Args: never; Returns: boolean }
      is_assigned_to_task: { Args: { p_task_id: string }; Returns: boolean }
      is_at_least: {
        Args: { r: Database["public"]["Enums"]["user_role"] }
        Returns: boolean
      }
      is_collections: { Args: never; Returns: boolean }
      is_external: { Args: never; Returns: boolean }
      is_goods_reception_assignee: { Args: never; Returns: boolean }
      is_maintenance: { Args: never; Returns: boolean }
      is_marketing: { Args: never; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
      is_owner_account: { Args: { p_profile_id: string }; Returns: boolean }
      is_reminder_participant: {
        Args: { p_reminder: string }
        Returns: boolean
      }
      is_sales: { Args: never; Returns: boolean }
      list_reminders: {
        Args: {
          p_creator?: string
          p_from?: string
          p_limit?: number
          p_link_type?: string
          p_offset?: number
          p_query?: string
          p_scope?: string
          p_to?: string
          p_view: string
        }
        Returns: {
          id: string
          total: number
        }[]
      }
      mark_inbox_read: { Args: { p_ids?: string[] }; Returns: undefined }
      materialise_task_days: { Args: { p_rows: Json }; Returns: number }
      meeting_conflicts: {
        Args: {
          p_date: string
          p_end: string
          p_exclude?: string
          p_people: string[]
          p_start: string
        }
        Returns: {
          end_date: string
          end_time: string
          first_day: string
          kind: string
          label: string
          last_day: string
          profile_id: string
          start_date: string
          start_time: string
        }[]
      }
      my_team: { Args: never; Returns: Database["public"]["Enums"]["team"] }
      my_teams: { Args: never; Returns: Database["public"]["Enums"]["team"][] }
      next_goods_reception_report_version: {
        Args: { p_month: string }
        Returns: number
      }
      next_incident_report_version: {
        Args: { p_month: string }
        Returns: number
      }
      order_is_prepared: { Args: { p_order_id: string }; Returns: boolean }
      order_set_box_quantity: {
        Args: { p_box_type_id: string; p_order_id: string; p_quantity: number }
        Returns: undefined
      }
      order_set_ready: {
        Args: { p_order_id: string; p_ready: boolean }
        Returns: undefined
      }
      order_set_route_position: {
        Args: { p_order_id: string; p_position: number }
        Returns: undefined
      }
      order_set_shipped: {
        Args: { p_order_ids: string[]; p_shipped: boolean }
        Returns: number
      }
      owns_quick_note: { Args: { p_note_id: string }; Returns: boolean }
      person_in_team_scope: { Args: { p_user_id: string }; Returns: boolean }
      preparation_date_for: {
        Args: { p_delivery_date: string; p_lead_days: number }
        Returns: string
      }
      recent_production_lots: {
        Args: { p_product_id: string }
        Returns: {
          best_before: string
          lot_number: string
          produced_on: string
        }[]
      }
      record_inbox_notification: {
        Args: {
          p_body: string
          p_level: string
          p_tag: string
          p_title: string
          p_url: string
          p_user_ids: string[]
        }
        Returns: undefined
      }
      record_production: {
        Args: {
          p_best_before: string
          p_lot: string
          p_note: string
          p_occurrence_id: string
          p_produced: number
          p_reason: string
        }
        Returns: undefined
      }
      reminder_attention_count: { Args: never; Returns: number }
      reminder_cancel: { Args: { p_id: string }; Returns: undefined }
      reminder_complete: {
        Args: { p_id: string; p_next_due_at: string }
        Returns: undefined
      }
      reminder_convert: { Args: { p_id: string }; Returns: string }
      reminder_guard: { Args: never; Returns: string }
      reminder_participant_candidates: {
        Args: never
        Returns: {
          email: string
          id: string
          name: string
        }[]
      }
      reminder_save: {
        Args: {
          p_due_at: string
          p_id: string
          p_link_id: string
          p_link_type: string
          p_notes: string
          p_notify_before: number
          p_participants: string[]
          p_recurrence: string
          p_timezone: string
          p_title: string
        }
        Returns: string
      }
      reminder_snooze: {
        Args: { p_id: string; p_until: string }
        Returns: undefined
      }
      reminders_eligible: { Args: { p_user: string }; Returns: boolean }
      reopen_occurrence: {
        Args: { p_occurrence_id: string }
        Returns: {
          assignee_id: string | null
          assignee_manual: boolean
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          completed_at: string | null
          completed_by: string | null
          covered_assignment_id: string | null
          created_at: string
          due_date: string
          due_date_override: string | null
          effective_due_date: string | null
          id: string
          period_key: string
          skip_reason: string | null
          skipped_at: string | null
          skipped_by: string | null
          source: Database["public"]["Enums"]["schedule_source"]
          status: Database["public"]["Enums"]["occurrence_status"]
          target_quantity: number | null
          task_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "task_occurrences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_password_reset: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      role_rank: {
        Args: { r: Database["public"]["Enums"]["user_role"] }
        Returns: number
      }
      sales_can_change: { Args: { p_salesperson_id: string }; Returns: boolean }
      sales_customer_file: { Args: { p_customer_id: string }; Returns: Json }
      sales_customer_list: {
        Args: never
        Returns: {
          city: string
          company_name: string
          company_name_addition: string
          id: string
          is_active: boolean
          last_order: string
          notes: number
          orders_90d: number
        }[]
      }
      sales_prospect_lose: {
        Args: { p_note: string; p_prospect_id: string; p_reason_id: string }
        Returns: undefined
      }
      sales_prospect_win: { Args: { p_prospect_id: string }; Returns: string }
      sales_quiet_customers: {
        Args: never
        Returns: {
          change_pct: number
          city: string
          company_name: string
          company_name_addition: string
          days_since: number
          id: string
          last_order: string
          last30: number
          late: boolean
          prev30: number
          rhythm_days: number
        }[]
      }
      sales_quiet_customers_all: {
        Args: never
        Returns: {
          change_pct: number
          city: string
          company_name: string
          company_name_addition: string
          days_since: number
          id: string
          last_order: string
          last30: number
          late: boolean
          prev30: number
          rhythm_days: number
        }[]
      }
      sales_report: { Args: { p_month: string }; Returns: Json }
      set_customer_prepay: {
        Args: { p_customer_id: string; p_on: boolean }
        Returns: undefined
      }
      set_line_shortfall: {
        Args: {
          p_code: string
          p_incident_description?: string
          p_note: string
          p_order_line_id: string
          p_report_incident?: boolean
        }
        Returns: Json
      }
      set_line_shortfall_reason: {
        Args: { p_order_line_id: string; p_reason: string }
        Returns: {
          created_at: string
          generated_quantity: number | null
          id: string
          note: string | null
          order_id: string
          ordered_quantity: number
          position: number
          product_id: string
          shortfall_code: string | null
          shortfall_incident_id: string | null
          shortfall_reason: string | null
          source_text: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "order_lines"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_occurrence_day_people: {
        Args: { p_occurrence_id: string; p_user_ids: string[] }
        Returns: string[]
      }
      set_production_target: {
        Args: { p_occurrence_id: string; p_quantity: number }
        Returns: undefined
      }
      set_task_assignees: {
        Args: { p_task_id: string; p_user_ids: string[] }
        Returns: string[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      skip_occurrence: {
        Args: { p_occurrence_id: string; p_reason: string }
        Returns: {
          assignee_id: string | null
          assignee_manual: boolean
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          completed_at: string | null
          completed_by: string | null
          covered_assignment_id: string | null
          created_at: string
          due_date: string
          due_date_override: string | null
          effective_due_date: string | null
          id: string
          period_key: string
          skip_reason: string | null
          skipped_at: string | null
          skipped_by: string | null
          source: Database["public"]["Enums"]["schedule_source"]
          status: Database["public"]["Enums"]["occurrence_status"]
          target_quantity: number | null
          task_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "task_occurrences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      task_day_set_people: {
        Args: {
          p_due_date: string
          p_manual: boolean
          p_people: string[]
          p_task_id: string
        }
        Returns: undefined
      }
      task_in_team_scope: { Args: { p_task_id: string }; Returns: boolean }
      task_people: { Args: { p_task_id: string }; Returns: string[] }
      task_resync_days: { Args: { p_task_id: string }; Returns: undefined }
      team_scope: { Args: never; Returns: Database["public"]["Enums"]["team"] }
      touch_presence: { Args: { p_path: string }; Returns: undefined }
    }
    Enums: {
      goods_reception_condition:
        | "good"
        | "damaged"
        | "partially_damaged"
        | "other_issue"
      goods_reception_quantity_check:
        | "not_checked"
        | "checked_ok"
        | "discrepancy"
      goods_reception_status: "draft" | "received" | "checking" | "completed"
      incident_cause:
        | "production"
        | "order_entry"
        | "picking"
        | "preparation"
        | "packing"
        | "dispatch"
        | "transport"
        | "delivery"
        | "supplier"
        | "customer"
        | "unknown"
        | "other"
      incident_responsibility:
        | "internal"
        | "transporter"
        | "supplier"
        | "customer"
        | "shared"
        | "unknown"
      incident_severity: "low" | "medium" | "high" | "critical"
      incident_status:
        | "open"
        | "investigating"
        | "action_required"
        | "resolved"
        | "closed"
      inventory_frequency: "weekly" | "biweekly" | "monthly" | "semiannual"
      inventory_grant_scope: "instance" | "all"
      inventory_kind: "expiry" | "lot" | "location"
      inventory_status: "in_progress" | "completed" | "to_review" | "resolved"
      occurrence_status: "pending" | "completed" | "skipped" | "blocked"
      order_status: "draft" | "confirmed" | "cancelled"
      order_type:
        | "sale"
        | "sample"
        | "replacement"
        | "sponsorship"
        | "consignment"
        | "event"
      schedule_source: "auto" | "manual"
      task_frequency:
        | "daily"
        | "weekly"
        | "biweekly"
        | "monthly"
        | "semiannual"
        | "one_off"
        | "as_needed"
      team:
        | "production"
        | "operations"
        | "sales"
        | "logistics"
        | "marketing"
        | "maintenance"
      user_role:
        | "admin"
        | "user"
        | "manager"
        | "power_user"
        | "production_manager"
        | "owner"
      user_status: "pending" | "approved" | "rejected" | "deactivated"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      goods_reception_condition: [
        "good",
        "damaged",
        "partially_damaged",
        "other_issue",
      ],
      goods_reception_quantity_check: [
        "not_checked",
        "checked_ok",
        "discrepancy",
      ],
      goods_reception_status: ["draft", "received", "checking", "completed"],
      incident_cause: [
        "production",
        "order_entry",
        "picking",
        "preparation",
        "packing",
        "dispatch",
        "transport",
        "delivery",
        "supplier",
        "customer",
        "unknown",
        "other",
      ],
      incident_responsibility: [
        "internal",
        "transporter",
        "supplier",
        "customer",
        "shared",
        "unknown",
      ],
      incident_severity: ["low", "medium", "high", "critical"],
      incident_status: [
        "open",
        "investigating",
        "action_required",
        "resolved",
        "closed",
      ],
      inventory_frequency: ["weekly", "biweekly", "monthly", "semiannual"],
      inventory_grant_scope: ["instance", "all"],
      inventory_kind: ["expiry", "lot", "location"],
      inventory_status: ["in_progress", "completed", "to_review", "resolved"],
      occurrence_status: ["pending", "completed", "skipped", "blocked"],
      order_status: ["draft", "confirmed", "cancelled"],
      order_type: [
        "sale",
        "sample",
        "replacement",
        "sponsorship",
        "consignment",
        "event",
      ],
      schedule_source: ["auto", "manual"],
      task_frequency: [
        "daily",
        "weekly",
        "biweekly",
        "monthly",
        "semiannual",
        "one_off",
        "as_needed",
      ],
      team: [
        "production",
        "operations",
        "sales",
        "logistics",
        "marketing",
        "maintenance",
      ],
      user_role: [
        "admin",
        "user",
        "manager",
        "power_user",
        "production_manager",
        "owner",
      ],
      user_status: ["pending", "approved", "rejected", "deactivated"],
    },
  },
} as const
