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
      customers: {
        Row: {
          company_name: string
          company_name_addition: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string | null
          updated_at: string
        }
        Insert: {
          company_name: string
          company_name_addition?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string | null
          updated_at?: string
        }
        Update: {
          company_name?: string
          company_name_addition?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      delivery_methods: {
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
          created_at: string
          difference: number | null
          digital_quantity: number | null
          id: string
          instance_id: string
          is_resolved: boolean
          item_group: string | null
          item_name: string
          item_sort_order: number
          physical_stock: number
          product_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["inventory_status"]
          template_item_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          difference?: number | null
          digital_quantity?: number | null
          id?: string
          instance_id: string
          is_resolved?: boolean
          item_group?: string | null
          item_name: string
          item_sort_order?: number
          physical_stock?: number
          product_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["inventory_status"]
          template_item_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          difference?: number | null
          digital_quantity?: number | null
          id?: string
          instance_id?: string
          is_resolved?: boolean
          item_group?: string | null
          item_name?: string
          item_sort_order?: number
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
          slug: string
          translations: Json
          updated_at: string
        }
        Insert: {
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
          slug: string
          translations?: Json
          updated_at?: string
        }
        Update: {
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
          slug?: string
          translations?: Json
          updated_at?: string
        }
        Relationships: [
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
          delivery_method_id: string | null
          delivery_time: string | null
          generated_from_template_id: string | null
          id: string
          import_key: string | null
          import_source: string | null
          note: string | null
          order_date: string
          order_type: Database["public"]["Enums"]["order_type"]
          preparation_date: string
          reference: number
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          delivery_date: string
          delivery_method_id?: string | null
          delivery_time?: string | null
          generated_from_template_id?: string | null
          id?: string
          import_key?: string | null
          import_source?: string | null
          note?: string | null
          order_date?: string
          order_type?: Database["public"]["Enums"]["order_type"]
          preparation_date: string
          reference?: never
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          delivery_date?: string
          delivery_method_id?: string | null
          delivery_time?: string | null
          generated_from_template_id?: string | null
          id?: string
          import_key?: string | null
          import_source?: string | null
          note?: string | null
          order_date?: string
          order_type?: Database["public"]["Enums"]["order_type"]
          preparation_date?: string
          reference?: never
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
      products: {
        Row: {
          category: string | null
          code: string | null
          created_at: string
          family: string
          id: string
          is_active: boolean
          name: string | null
          needs_review: boolean
          notes: string | null
          presentation: string
          units_per_box: number | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          code?: string | null
          created_at?: string
          family: string
          id?: string
          is_active?: boolean
          name?: string | null
          needs_review?: boolean
          notes?: string | null
          presentation: string
          units_per_box?: number | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          code?: string | null
          created_at?: string
          family?: string
          id?: string
          is_active?: boolean
          name?: string | null
          needs_review?: boolean
          notes?: string | null
          presentation?: string
          units_per_box?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          last_seen_at: string | null
          name: string | null
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["user_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          last_seen_at?: string | null
          name?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          last_seen_at?: string | null
          name?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Relationships: []
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
          created_at: string
          customer_id: string
          delivery_method_id: string | null
          delivery_weekday: number
          id: string
          is_active: boolean
          name: string | null
          note: string | null
          order_type: Database["public"]["Enums"]["order_type"]
          preparation_lead_days: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          delivery_method_id?: string | null
          delivery_weekday: number
          id?: string
          is_active?: boolean
          name?: string | null
          note?: string | null
          order_type?: Database["public"]["Enums"]["order_type"]
          preparation_lead_days?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          delivery_method_id?: string | null
          delivery_weekday?: number
          id?: string
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
      task_occurrences: {
        Row: {
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          completed_at: string | null
          completed_by: string | null
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
          task_id: string
          updated_at: string
        }
        Insert: {
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          completed_at?: string | null
          completed_by?: string | null
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
          task_id: string
          updated_at?: string
        }
        Update: {
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          completed_at?: string | null
          completed_by?: string | null
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
          task_id?: string
          updated_at?: string
        }
        Relationships: [
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
          frequency: Database["public"]["Enums"]["task_frequency"]
          id: string
          is_active: boolean
          is_skippable: boolean
          schedule_config: Json | null
          title: string
          translations: Json
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          frequency: Database["public"]["Enums"]["task_frequency"]
          id?: string
          is_active?: boolean
          is_skippable?: boolean
          schedule_config?: Json | null
          title: string
          translations?: Json
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          frequency?: Database["public"]["Enums"]["task_frequency"]
          id?: string
          is_active?: boolean
          is_skippable?: boolean
          schedule_config?: Json | null
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
        ]
      }
    }
    Views: {
      lot_allocation_search: {
        Row: {
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
        ]
      }
      operational_audit: {
        Row: {
          action: string | null
          actor_id: string | null
          created_at: string | null
          id: string | null
          new_value: Json | null
          previous_value: Json | null
          source: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      block_occurrence: {
        Args: { p_occurrence_id: string; p_reason: string }
        Returns: {
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          completed_at: string | null
          completed_by: string | null
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
      claim_push_subscription: {
        Args: {
          p_auth: string
          p_endpoint: string
          p_p256dh: string
          p_user_agent?: string
        }
        Returns: undefined
      }
      complete_occurrence: {
        Args: { p_occurrence_id: string }
        Returns: {
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          completed_at: string | null
          completed_by: string | null
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
      generate_order_from_template: {
        Args: { p_delivery_date: string; p_template_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          customer_id: string
          delivery_date: string
          delivery_method_id: string | null
          delivery_time: string | null
          generated_from_template_id: string | null
          id: string
          import_key: string | null
          import_source: string | null
          note: string | null
          order_date: string
          order_type: Database["public"]["Enums"]["order_type"]
          preparation_date: string
          reference: number
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
      has_permission: { Args: { p_key: string }; Returns: boolean }
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
          created_at: string
          difference: number | null
          digital_quantity: number | null
          id: string
          instance_id: string
          is_resolved: boolean
          item_group: string | null
          item_name: string
          item_sort_order: number
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
          created_at: string
          difference: number | null
          digital_quantity: number | null
          id: string
          instance_id: string
          is_resolved: boolean
          item_group: string | null
          item_name: string
          item_sort_order: number
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
      inventory_sync_instance_status: {
        Args: { p_instance_id: string }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      is_approved: { Args: never; Returns: boolean }
      is_at_least: {
        Args: { r: Database["public"]["Enums"]["user_role"] }
        Returns: boolean
      }
      preparation_date_for: {
        Args: { p_delivery_date: string; p_lead_days: number }
        Returns: string
      }
      reopen_occurrence: {
        Args: { p_occurrence_id: string }
        Returns: {
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          completed_at: string | null
          completed_by: string | null
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
      role_rank: {
        Args: { r: Database["public"]["Enums"]["user_role"] }
        Returns: number
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      skip_occurrence: {
        Args: { p_occurrence_id: string; p_reason: string }
        Returns: {
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          completed_at: string | null
          completed_by: string | null
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
    }
    Enums: {
      inventory_frequency: "weekly" | "biweekly" | "monthly" | "semiannual"
      inventory_grant_scope: "instance" | "all"
      inventory_kind: "expiry" | "lot" | "location"
      inventory_status: "in_progress" | "completed" | "to_review" | "resolved"
      occurrence_status: "pending" | "completed" | "skipped" | "blocked"
      order_status: "draft" | "confirmed" | "cancelled"
      order_type: "sale" | "sample"
      schedule_source: "auto" | "manual"
      task_frequency: "daily" | "weekly" | "biweekly" | "monthly" | "semiannual"
      user_role: "admin" | "user" | "manager" | "power_user"
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
      inventory_frequency: ["weekly", "biweekly", "monthly", "semiannual"],
      inventory_grant_scope: ["instance", "all"],
      inventory_kind: ["expiry", "lot", "location"],
      inventory_status: ["in_progress", "completed", "to_review", "resolved"],
      occurrence_status: ["pending", "completed", "skipped", "blocked"],
      order_status: ["draft", "confirmed", "cancelled"],
      order_type: ["sale", "sample"],
      schedule_source: ["auto", "manual"],
      task_frequency: ["daily", "weekly", "biweekly", "monthly", "semiannual"],
      user_role: ["admin", "user", "manager", "power_user"],
      user_status: ["pending", "approved", "rejected", "deactivated"],
    },
  },
} as const
