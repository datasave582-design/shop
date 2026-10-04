; Uninstall par business data ke baare mein poochna. Default = Keep Data.
; Update ke waqt (silent re-install) ye prompt nahi aata aur data kabhi delete nahi hota.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Shop data ko rakhna hai?$\r$\n$\r$\nYes = Keep Data (recommended)$\r$\nNo = Remove Data (sab sales/products hamesha ke liye delete)" /SD IDYES IDYES keep_shop_data
    RMDir /r "$COMMONAPPDATA\ShopManagement"
    keep_shop_data:
  ${endIf}
!macroend
